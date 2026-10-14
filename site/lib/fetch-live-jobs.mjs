import { env } from 'cloudflare:workers';
import { validateLiveJobs } from './live-jobs.mjs';

const MAX_UPSTREAM_BYTES = 256 * 1024;

function telemetryFetch() {
  const binding = /** @type {{ TELEMETRY?: { fetch: typeof fetch } }} */ (env).TELEMETRY;
  return binding?.fetch?.bind(binding) ?? fetch;
}

function liveUpstreamBase() {
  if (env.COMMUNITY_JOBS_LIVE_UPSTREAM) return env.COMMUNITY_JOBS_LIVE_UPSTREAM;
  if (env.COMMUNITY_JOBS_UPSTREAM) {
    try {
      const url = new URL(env.COMMUNITY_JOBS_UPSTREAM);
      url.pathname = '/v1/jobs/live';
      url.search = '';
      return url.toString();
    } catch {
      /* fall through */
    }
  }
  if (env.COMMUNITY_STATS_UPSTREAM) {
    try {
      return new URL('/v1/jobs/live', env.COMMUNITY_STATS_UPSTREAM).toString();
    } catch {
      /* fall through */
    }
  }
  return null;
}

/**
 * @param {{ fetcher?: typeof fetch, signal?: AbortSignal }} [options]
 */
export async function loadLiveJobs(options = {}) {
  const base = liveUpstreamBase();
  if (!base) return [];
  const fetcher = options.fetcher ?? telemetryFetch();
  const jobs = new Map();
  const cursors = new Set();
  let cursor = null;
  for (let page = 0; page < 200; page++) {
    const target = new URL(base);
    target.searchParams.set('limit', '100');
    if (cursor) target.searchParams.set('cursor', cursor);
    const response = await fetcher(new Request(target.toString(), {
      headers: { accept: 'application/json' },
      signal: options.signal,
    }));
    if (!response.ok) throw new Error('Live jobs unavailable');
    const raw = await response.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_UPSTREAM_BYTES) throw new Error('Live jobs response too large');
    const validated = validateLiveJobs(JSON.parse(raw));
    if (!validated.ok) throw new Error('Invalid live jobs response');
    for (const job of validated.data.jobs) jobs.set(job.jobId, job);
    cursor = validated.data.nextCursor;
    if (!cursor) return [...jobs.values()];
    if (cursors.has(cursor)) throw new Error('Repeated live jobs cursor');
    cursors.add(cursor);
  }
  throw new Error('Live jobs page limit exceeded');
}

/**
 * Safe loader for pages/sitemap — empty on failure so SEO pages still render.
 * @param {{ fetcher?: typeof fetch }} [options]
 */
export async function loadLiveJobsSafe(options = {}) {
  try {
    return await loadLiveJobs(options);
  } catch {
    return [];
  }
}
