import locations from '../data/job-locations.json' with { type: 'json' };
import { fixtureLiveJobs } from './jobs-board-data.mjs';
import { jobIdFromSlug, jobSlug, isListedOpenJob } from './live-jobs.mjs';
import { attachLocations } from './job-locations.mjs';

async function wantsFixtures(options = {}) {
  if (options.useFixtures === true) return true;
  if (options.useFixtures === false) return false;
  if (typeof process !== 'undefined' && process.env?.USE_JOBS_BOARD_FIXTURES === '1') return true;
  try {
    const { env } = await import('cloudflare:workers');
    if (env?.USE_JOBS_BOARD_FIXTURES === '1') return true;
  } catch {
    /* outside Workers runtime */
  }
  return false;
}

/**
 * Resolve board jobs for SSR pages.
 * Prefer a caller-provided fetcher (tests). Fall back to live Worker fetch.
 * Set USE_JOBS_BOARD_FIXTURES=1 for demos/screenshots.
 *
 * @param {{
 *   loadLive?: () => Promise<unknown[]>,
 *   useFixtures?: boolean,
 *   now?: number,
 * }} [options]
 */
export async function loadJobsBoard(options = {}) {
  const now = options.now ?? Date.now();
  let raw = [];

  if (await wantsFixtures(options)) {
    raw = fixtureLiveJobs(now);
  } else if (options.loadLive) {
    raw = await options.loadLive();
  } else {
    try {
      const { loadLiveJobsSafe } = await import('./fetch-live-jobs.mjs');
      raw = await loadLiveJobsSafe();
    } catch {
      raw = [];
    }
  }

  const withSlugs = (raw ?? []).map((job) => ({
    ...job,
    slug: job.slug ?? jobSlug(job),
  }));

  const needsIndex = withSlugs.some((job) => !job.location);
  const enriched = needsIndex
    ? attachLocations(withSlugs, { collectedAt: locations.collectedAt, records: locations.records }, now)
    : withSlugs;

  const open = enriched.filter((job) => isListedOpenJob(job, now));
  const all = enriched;

  let checkedAt = null;
  for (const job of open) {
    if (job.lastCheckedAt && (!checkedAt || job.lastCheckedAt > checkedAt)) checkedAt = job.lastCheckedAt;
  }

  return { all, open, checkedAt, now, locationIndex: locations };
}

export function findJobBySlug(allJobs, slug) {
  const exact = allJobs.find((job) => job.slug === slug);
  if (exact) return exact;
  const jobId = jobIdFromSlug(slug);
  if (!jobId) return null;
  return allJobs.find((job) => job.jobId === jobId) ?? null;
}
