import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyRoleFamily,
  filterBoardJobs,
  isListedOpenJob,
  jobIdFromSlug,
  jobPostingJsonLd,
  jobSlug,
  similarOpenRoles,
  validateLiveJobs,
  TRUST_LINE,
} from '../lib/live-jobs.mjs';
import { fixtureLiveJobs } from '../lib/jobs-board-data.mjs';

const now = Date.parse('2026-10-13T12:00:00.000Z');

test('jobSlug is stable from company, role, and job id', () => {
  const job = {
    jobId: 'community-job-aaaaaaaaaaaaaaaa',
    company: 'Example Labs',
    role: 'Senior Backend Engineer',
  };
  assert.equal(jobSlug(job), 'example-labs-senior-backend-engineer-aaaaaaaaaaaaaaaa');
  assert.equal(jobIdFromSlug(jobSlug(job)), job.jobId);
});

test('validateLiveJobs accepts liveness fields and rejects unknown keys', () => {
  const jobs = fixtureLiveJobs(now).map((job) => {
    const rest = { ...job };
    delete rest.location;
    delete rest.slug;
    return rest;
  });
  const ok = validateLiveJobs({ version: 1, jobs, nextCursor: null });
  assert.equal(ok.ok, true);
  assert.equal(ok.data.jobs[0].livenessStatus, 'open');

  const bad = validateLiveJobs({
    version: 1,
    jobs: [{ ...jobs[0], contributorHash: 'nope' }],
    nextCursor: null,
  });
  assert.equal(bad.ok, false);
});

test('board listing hides stale and non-open roles', () => {
  const jobs = fixtureLiveJobs(now);
  const open = jobs.filter((job) => isListedOpenJob(job, now));
  assert.ok(open.every((job) => job.livenessStatus === 'open'));
  assert.ok(open.length >= 3);

  const stale = { ...open[0], lastCheckedAt: '2026-10-01T00:00:00.000Z' };
  assert.equal(isListedOpenJob(stale, now), false);

  const filtered = filterBoardJobs(open, { role: 'Engineering', postedDays: 14, now });
  assert.ok(filtered.every((job) => classifyRoleFamily(job.role) === 'Engineering'));
});

test('closed job JSON-LD sets validThrough and similar roles exclude self', () => {
  const jobs = fixtureLiveJobs(now);
  const closed = jobs.find((job) => job.livenessStatus === 'closed');
  const open = jobs.filter((job) => isListedOpenJob(job, now));
  assert.ok(closed);
  const jsonLd = jobPostingJsonLd(closed);
  assert.equal(jsonLd['@type'], 'JobPosting');
  assert.equal(jsonLd.validThrough, closed.closedAt.slice(0, 10));
  assert.match(jsonLd.description, new RegExp(TRUST_LINE));
  assert.match(jsonLd.description, new RegExp(closed.company));
  assert.equal('jobLocationType' in jsonLd && jsonLd.jobLocationType === undefined, false);

  const similar = similarOpenRoles(closed, open, 3);
  assert.ok(similar.every((job) => job.jobId !== closed.jobId));
  assert.ok(similar.length <= 3);
});

test('open remote JobPosting JSON-LD has validThrough, TELECOMMUTE, and country requirements', () => {
  const jobs = fixtureLiveJobs(now);
  const remote = jobs.find((job) => job.livenessStatus === 'open' && job.location?.workplace === 'remote');
  assert.ok(remote);
  const jsonLd = jobPostingJsonLd(remote);
  assert.equal(jsonLd.jobLocationType, 'TELECOMMUTE');
  assert.ok(jsonLd.applicantLocationRequirements);
  assert.ok(jsonLd.validThrough);
  assert.match(jsonLd.description, new RegExp(remote.role));
  assert.match(jsonLd.description, new RegExp(remote.company));
  if (remote.location?.countries?.[0]) {
    assert.equal(jsonLd.jobLocation?.address?.addressCountry, remote.location.countries[0].toUpperCase());
  }
});

test('validateLiveJobs accepts optional meta.newestLastCheckedAt', () => {
  const jobs = fixtureLiveJobs(now).map((job) => {
    const rest = { ...job };
    delete rest.location;
    delete rest.slug;
    return rest;
  });
  const ok = validateLiveJobs({
    version: 1,
    jobs,
    nextCursor: null,
    meta: { newestLastCheckedAt: '2026-10-13T12:00:00.000Z' },
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.data.meta.newestLastCheckedAt, '2026-10-13T12:00:00.000Z');
});

test('trust wording stays endorsement-safe', () => {
  assert.equal(TRUST_LINE, 'Reviewed and live, checked daily');
  assert.doesNotMatch(TRUST_LINE, /verified/i);
});
