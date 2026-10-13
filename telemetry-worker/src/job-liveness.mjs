const label = (value) => (typeof value === 'string' && value.trim().length <= 240 && !/[<>]/.test(value) && ![...value].some((char) => char.charCodeAt(0) < 32) ? value.trim() : '');
const title = (value) => label(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

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

export async function checkJobLiveness(job, { fetchImpl = fetch, now = new Date() } = {}) {
  const checkedAt = now.toISOString();
  const target = atsTarget(job?.url);
  if (!target) return checked('unknown', checkedAt);

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

async function listAllPublished(store) {
  const jobs = [];
  let cursor = null;
  for (;;) {
    const page = await store.listLive({ limit: 100, cursor });
    jobs.push(...page.jobs);
    if (!page.hasMore || page.jobs.length === 0) break;
    const last = page.jobs.at(-1);
    cursor = { jobId: last.jobId, lastSeenAt: last.lastSeenAt };
  }
  return jobs;
}

export async function runJobLivenessSweep(env, { fetchImpl = fetch, now = new Date(), concurrency = 4, store } = {}) {
  const jobStore = store ?? env.JOB_STORE;
  if (!jobStore?.listLive || !jobStore?.updateLiveness) throw new Error('Job store unavailable.');

  const jobs = await listAllPublished(jobStore);
  let position = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (position < jobs.length) {
      const job = jobs[position++];
      const result = await checkJobLiveness(job, { fetchImpl, now });
      const existingClosedAt = job.closedAt ?? null;
      const closedAt = result.status === 'closed'
        ? (existingClosedAt ?? result.checkedAt)
        : result.status === 'open'
          ? null
          : existingClosedAt;
      await jobStore.updateLiveness(job.jobId, {
        status: result.status,
        checkedAt: result.checkedAt,
        closedAt,
      });
    }
  });
  await Promise.all(workers);
  return { checked: jobs.length };
}
