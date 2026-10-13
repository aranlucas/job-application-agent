import fixtures from '../data/jobs-board-fixtures.json' with { type: 'json' };
import { jobSlug, validateLiveJobs, isListedOpenJob, attachBoardLocations } from './live-jobs.mjs';

function withSlugs(jobs) {
  return jobs.map((job) => {
    const { location, ...rest } = job;
    const slug = job.slug ?? jobSlug(rest);
    return location ? { ...rest, slug, location } : { ...rest, slug };
  });
}

/** Fixture jobs for tests/screenshots — not production registry data. */
export function fixtureLiveJobs(now = Date.now()) {
  const checkedAt = new Date(now).toISOString();
  const stripped = fixtures.jobs.map((job) => {
    const rest = { ...job };
    delete rest.location;
    // Keep closed_at from fixtures; refresh last_checked so open roles stay board-fresh.
    return {
      ...rest,
      lastCheckedAt: checkedAt,
      ...(rest.livenessStatus === 'closed' ? {} : { closedAt: null }),
    };
  });
  const validated = validateLiveJobs({ version: 1, jobs: stripped, nextCursor: null });
  if (!validated.ok) throw new Error('Invalid jobs board fixtures');
  const byId = new Map(fixtures.jobs.map((job) => [job.jobId, job]));
  return validated.data.jobs.map((job) => {
    const location = byId.get(job.jobId)?.location ?? null;
    return location ? { ...job, location } : job;
  });
}

/**
 * @param {unknown[]} jobs
 * @param {{ locationIndex?: { collectedAt: string, records: unknown[] }, now?: number, includeClosed?: boolean }} [options]
 */
export function prepareBoardJobs(jobs, options = {}) {
  const now = options.now ?? Date.now();
  const withLocations = options.locationIndex
    ? attachBoardLocations(jobs, options.locationIndex, now)
    : withSlugs(jobs);
  if (options.includeClosed) return withLocations;
  return withLocations.filter((job) => isListedOpenJob(job, now));
}

export function fixtureBoardState(now = Date.parse('2026-10-13T12:00:00.000Z')) {
  const all = fixtureLiveJobs();
  return {
    all,
    open: prepareBoardJobs(all, { includeClosed: false, now }),
    checkedAt: fixtures.collectedAt,
    now,
  };
}
