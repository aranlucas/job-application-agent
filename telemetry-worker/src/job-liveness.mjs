const label = (value) => (typeof value === 'string' && value.trim().length <= 240 && !/[<>]/.test(value) && ![...value].some((char) => char.charCodeAt(0) < 32) ? value.trim() : '');
const title = (value) => label(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Bounded batch size per cron/admin invocation (Worker subrequest / CPU safe). */
export const DEFAULT_LIVENESS_BATCH_SIZE = 50;
export const DEFAULT_LIVENESS_CONCURRENCY = 4;

const CLOSED_PHRASING = [
  'no longer accepting',
  'no longer available',
  'no longer open',
  'position has been filled',
  'position is filled',
  'job has been filled',
  'this job is closed',
  'this role is closed',
  'this position is closed',
  'applications are closed',
  'application is closed',
  'applications have closed',
  'posting has expired',
  'job posting has expired',
  'this job posting has been removed',
  'role is no longer',
  'opportunity is no longer',
  'sorry, this position',
  'this vacancy is closed',
];

const CAREERS_INDEX_PATHS = new Set([
  '/careers',
  '/career',
  '/jobs',
  '/job',
  '/join',
  '/join-us',
  '/joinus',
  '/opportunities',
  '/openings',
  '/vacancies',
  '/work-with-us',
  '/work-with-us/',
]);

function canonical(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname.replace(/\/(?:apply|application)\/?$/, '').replace(/\/$/, '')}`;
  } catch {
    return '';
  }
}

function titlesMatch(atsTitle, jobTitle) {
  const a = title(atsTitle);
  const b = title(jobTitle);
  if (!a || !b) return false;
  if (a === b) return true;
  const stripSuffix = (val) => label(val)
    .replace(/\s*\([^)]*\)$/, '')
    .replace(/\s*-[^-]+$/, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  const aClean = stripSuffix(atsTitle);
  const bClean = stripSuffix(jobTitle);
  if (aClean === b || a === bClean || (aClean && aClean === bClean)) return true;
  if (a.length > 8 && b.length > 8 && (a.startsWith(b) || b.startsWith(a))) return true;
  return false;
}

export function atsTarget(value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  const parts = url.pathname.split('/').filter(Boolean).filter((part) => !['apply', 'application'].includes(part));
  if (parts.length < 2) return null;

  if (url.hostname === 'jobs.ashbyhq.com') {
    const [board, id] = parts;
    if (/^[\w.-]+$/.test(board) && /^[\w-]+$/.test(id)) {
      return { kind: 'ashby', id, url: `https://api.ashbyhq.com/posting-api/job-board/${board}` };
    }
  }

  if (['boards.greenhouse.io', 'job-boards.greenhouse.io', 'job-boards.eu.greenhouse.io'].includes(url.hostname)) {
    const [board, segment, id] = parts;
    if (segment === 'jobs' && /^\d+$/.test(id) && /^[\w-]+$/.test(board)) {
      return { kind: 'greenhouse', id, url: `https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${id}` };
    }
  }

  if (['jobs.lever.co', 'jobs.eu.lever.co'].includes(url.hostname)) {
    const [board, id] = parts;
    if (/^[\w-]+$/.test(board) && /^[\w-]+$/.test(id)) {
      return { kind: 'lever', id, url: `https://${url.hostname === 'jobs.eu.lever.co' ? 'api.eu.lever.co' : 'api.lever.co'}/v0/postings/${board}/${id}` };
    }
  }

  if (url.hostname === 'apply.workable.com') {
    const [account, segment, id] = parts;
    if (segment === 'j' && /^[\w-]+$/.test(account) && /^[\w-]+$/.test(id)) {
      return { kind: 'workable', id, url: `https://apply.workable.com/api/v2/accounts/${account}/jobs/${id}` };
    }
  }

  return null;
}

function postingMatches(job, target, data) {
  if (!data || typeof data !== 'object') return false;

  if (target.kind === 'ashby') {
    const entry = Array.isArray(data.jobs) ? data.jobs.find((item) => item?.id === target.id) : null;
    if (!entry || entry.isListed === false) return false;
    if (!titlesMatch(entry.title, job.role)) return false;
    if (canonical(entry.jobUrl) !== canonical(job.url)) return false;
    return true;
  }

  if (target.kind === 'greenhouse') {
    if (String(data.id) !== target.id || !titlesMatch(data.title, job.role)) return false;
    if (data.absolute_url) {
      let isGreenhouseHost = false;
      try {
        const host = new URL(data.absolute_url).hostname;
        isGreenhouseHost = host === 'greenhouse.io' || host.endsWith('.greenhouse.io');
      } catch {
        isGreenhouseHost = false;
      }
      if (isGreenhouseHost) {
        const normalize = (value) => canonical(value).replace('://boards.greenhouse.io/', '://job-boards.greenhouse.io/');
        if (normalize(data.absolute_url) !== normalize(job.url)) return false;
      }
    }
    return true;
  }

  if (target.kind === 'lever') {
    if (data.id !== target.id || !titlesMatch(data.text, job.role)) return false;
    if (canonical(data.hostedUrl) !== canonical(job.url)) return false;
    return true;
  }

  if (target.kind === 'workable') {
    return titlesMatch(data.title, job.role);
  }

  return false;
}

function checked(status, checkedAt) {
  return { status, checkedAt };
}

function isCareersIndexPath(pathname) {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  if (CAREERS_INDEX_PATHS.has(normalized) || CAREERS_INDEX_PATHS.has(`${normalized}/`)) return true;
  // Single-segment board roots such as /jobs or /careers already covered; also
  // /company/careers and /en/careers with no further job id.
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length >= 1 && parts.length <= 2) {
    const leaf = parts.at(-1)?.toLowerCase() ?? '';
    if (['careers', 'career', 'jobs', 'job', 'join', 'join-us', 'opportunities', 'openings', 'vacancies'].includes(leaf)) {
      return true;
    }
  }
  return false;
}

/** True when a redirect landed on a generic careers/jobs index (posting gone). */
export function isCareersIndexRedirect(originalUrl, finalUrl) {
  let original;
  let final;
  try {
    original = new URL(originalUrl);
    final = new URL(finalUrl);
  } catch {
    return false;
  }
  if (canonical(original.href) === canonical(final.href)) return false;
  if (final.origin !== original.origin && !isCareersIndexPath(final.pathname)) return false;
  return isCareersIndexPath(final.pathname);
}

function htmlLooksClosed(text) {
  const lower = text.toLowerCase();
  return CLOSED_PHRASING.some((phrase) => lower.includes(phrase));
}

function htmlContainsRoleTitle(text, role) {
  const needle = title(role);
  if (!needle || needle.length < 3) return false;
  const hay = title(text.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' '));
  return hay.includes(needle);
}

/**
 * Conservative generic HTML liveness for non-ATS URLs.
 * open: 200 + role title present + no closed phrasing
 * closed: 404/410 or redirect to careers index
 * unknown: everything else
 */
export async function checkGenericHtmlLiveness(job, { fetchImpl = fetch, now = new Date() } = {}) {
  const checkedAt = now.toISOString();
  let url;
  try {
    url = new URL(job?.url);
  } catch {
    return checked('unknown', checkedAt);
  }
  if (url.protocol !== 'https:' || url.username || url.password) return checked('unknown', checkedAt);

  let response;
  try {
    response = await fetchImpl(url.href, {
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
      headers: {
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'user-agent': 'JobAppAgentLiveness/1.0 (+https://jobappagent.com/jobs)',
      },
    });
  } catch {
    return checked('unknown', checkedAt);
  }

  if (response.status === 404 || response.status === 410) return checked('closed', checkedAt);
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (location && isCareersIndexRedirect(url.href, new URL(location, url).href)) return checked('closed', checkedAt);
    return checked('unknown', checkedAt);
  }
  if (!response.ok) return checked('unknown', checkedAt);

  const finalUrl = response.url || url.href;
  if (isCareersIndexRedirect(url.href, finalUrl)) return checked('closed', checkedAt);

  let body;
  try {
    body = await response.text();
  } catch {
    return checked('unknown', checkedAt);
  }
  // Cap work on huge pages.
  const sample = body.length > 500_000 ? body.slice(0, 500_000) : body;
  if (htmlLooksClosed(sample)) return checked('unknown', checkedAt);
  if (!htmlContainsRoleTitle(sample, job.role)) return checked('unknown', checkedAt);
  return checked('open', checkedAt);
}

async function checkAtsLiveness(job, target, { fetchImpl, checkedAt }) {
  let response;
  try {
    response = await fetchImpl(target.url, {
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      headers: { accept: 'application/json' },
    });
  } catch {
    return checked('unknown', checkedAt);
  }

  if (response.status === 404) return checked('closed', checkedAt);
  if (!response.ok) return checked('unknown', checkedAt);

  let data;
  try {
    data = await response.json();
  } catch {
    return checked('unknown', checkedAt);
  }

  return checked(postingMatches(job, target, data) ? 'open' : 'closed', checkedAt);
}

export async function checkJobLiveness(job, { fetchImpl = fetch, now = new Date() } = {}) {
  const checkedAt = now.toISOString();
  const target = atsTarget(job?.url);
  if (target) return checkAtsLiveness(job, target, { fetchImpl, checkedAt });
  return checkGenericHtmlLiveness(job, { fetchImpl, now });
}

function closedAtFor(job, result) {
  const existingClosedAt = job.closedAt ?? null;
  if (result.status === 'closed') return existingClosedAt ?? result.checkedAt;
  if (result.status === 'open') return null;
  return existingClosedAt;
}

function summarize(results) {
  let open = 0;
  let closed = 0;
  let unknown = 0;
  for (const result of results) {
    if (result.status === 'open') open += 1;
    else if (result.status === 'closed') closed += 1;
    else unknown += 1;
  }
  return { open, closed, unknown };
}

/**
 * Process a bounded batch of oldest-checked published jobs.
 * Writes via store.updateLivenessBatch (D1 db.batch) when available.
 */
export async function runJobLivenessSweep(env, {
  fetchImpl = fetch,
  now = new Date(),
  concurrency = DEFAULT_LIVENESS_CONCURRENCY,
  limit = DEFAULT_LIVENESS_BATCH_SIZE,
  store,
  log = console.log,
} = {}) {
  const jobStore = store ?? env.JOB_STORE;
  if (!jobStore?.listDueForLivenessCheck) throw new Error('Job store unavailable.');
  if (!jobStore?.updateLivenessBatch && !jobStore?.updateLiveness) throw new Error('Job store unavailable.');

  const batchLimit = Math.max(1, Math.min(100, Number(limit) || DEFAULT_LIVENESS_BATCH_SIZE));
  const page = await jobStore.listDueForLivenessCheck({ limit: batchLimit });
  const jobs = page?.jobs ?? [];
  const results = new Array(jobs.length);
  let position = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (position < jobs.length) {
      const index = position++;
      const job = jobs[index];
      const result = await checkJobLiveness(job, { fetchImpl, now });
      results[index] = {
        jobId: job.jobId,
        status: result.status,
        checkedAt: result.checkedAt,
        closedAt: closedAtFor(job, result),
      };
    }
  });
  await Promise.all(workers);

  if (results.length > 0) {
    if (jobStore.updateLivenessBatch) {
      await jobStore.updateLivenessBatch(results);
    } else {
      for (const patch of results) {
        await jobStore.updateLiveness(patch.jobId, patch);
      }
    }
  }

  const counts = summarize(results);
  const summary = {
    checked: results.length,
    open: counts.open,
    closed: counts.closed,
    unknown: counts.unknown,
    hasMore: Boolean(page?.hasMore),
  };
  log(`[liveness] checked=${summary.checked} open=${summary.open} closed=${summary.closed} unknown=${summary.unknown} hasMore=${summary.hasMore}`);
  return summary;
}
