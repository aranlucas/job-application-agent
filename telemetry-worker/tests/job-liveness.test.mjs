import assert from 'node:assert/strict';
import test from 'node:test';

import { checkJobLiveness, runJobLivenessSweep } from '../src/job-liveness.mjs';

test('greenhouse 200 with matching title is open', async () => {
  const job = {
    jobId: 'community-job-aaaaaaaaaaaaaaaa',
    url: 'https://job-boards.greenhouse.io/acme/jobs/999001',
    role: 'Senior Product Engineer',
  };
  const result = await checkJobLiveness(job, {
    now: new Date('2026-10-13T12:00:00.000Z'),
    fetchImpl: async (url) => {
      assert.equal(url, 'https://boards-api.greenhouse.io/v1/boards/acme/jobs/999001');
      return Response.json({
        id: 999001,
        title: 'Senior Product Engineer',
        absolute_url: 'https://job-boards.greenhouse.io/acme/jobs/999001',
      });
    },
  });
  assert.deepEqual(result, { status: 'open', checkedAt: '2026-10-13T12:00:00.000Z' });
});

test('greenhouse 404 is closed', async () => {
  const job = {
    jobId: 'community-job-bbbbbbbbbbbbbbbb',
    url: 'https://job-boards.greenhouse.io/acme/jobs/999002',
    role: 'Senior Product Engineer',
  };
  const result = await checkJobLiveness(job, {
    now: new Date('2026-10-13T12:00:00.000Z'),
    fetchImpl: async () => new Response('gone', { status: 404 }),
  });
  assert.deepEqual(result, { status: 'closed', checkedAt: '2026-10-13T12:00:00.000Z' });
});

test('unsupported ATS host stays unknown even on HTTP 200', async () => {
  const job = {
    jobId: 'community-job-cccccccccccccccc',
    url: 'https://careers.example.com/jobs/123',
    role: 'Engineer',
  };
  let fetched = false;
  const result = await checkJobLiveness(job, {
    now: new Date('2026-10-13T12:00:00.000Z'),
    fetchImpl: async () => {
      fetched = true;
      return new Response('ok', { status: 200 });
    },
  });
  assert.equal(fetched, false);
  assert.deepEqual(result, { status: 'unknown', checkedAt: '2026-10-13T12:00:00.000Z' });
});

test('network errors leave liveness unknown', async () => {
  const job = {
    jobId: 'community-job-dddddddddddddddd',
    url: 'https://job-boards.greenhouse.io/acme/jobs/999003',
    role: 'Engineer',
  };
  const result = await checkJobLiveness(job, {
    now: new Date('2026-10-13T12:00:00.000Z'),
    fetchImpl: async () => { throw new Error('dns failed'); },
  });
  assert.deepEqual(result, { status: 'unknown', checkedAt: '2026-10-13T12:00:00.000Z' });
});

test('title mismatch on a supported ATS is closed', async () => {
  const job = {
    jobId: 'community-job-eeeeeeeeeeeeeeee',
    url: 'https://job-boards.greenhouse.io/acme/jobs/999004',
    role: 'Staff Engineer',
  };
  const result = await checkJobLiveness(job, {
    now: new Date('2026-10-13T12:00:00.000Z'),
    fetchImpl: async () => Response.json({
      id: 999004,
      title: 'Completely Different Role',
      absolute_url: job.url,
    }),
  });
  assert.equal(result.status, 'closed');
});

test('runJobLivenessSweep updates open and closed rows and preserves existing closedAt', async () => {
  const records = new Map([
    ['open-job', {
      jobId: 'open-job',
      url: 'https://job-boards.greenhouse.io/acme/jobs/1',
      role: 'Open Role',
      lastSeenAt: '2026-10-12T00:00:00.000Z',
      livenessStatus: 'unknown',
      lastCheckedAt: null,
      closedAt: null,
      publicationStatus: 'published',
      reviewStatus: 'maintainer-reviewed',
    }],
    ['closed-job', {
      jobId: 'closed-job',
      url: 'https://job-boards.greenhouse.io/acme/jobs/2',
      role: 'Closed Role',
      lastSeenAt: '2026-10-11T00:00:00.000Z',
      livenessStatus: 'closed',
      lastCheckedAt: '2026-09-01T00:00:00.000Z',
      closedAt: '2026-09-01T00:00:00.000Z',
      publicationStatus: 'published',
      reviewStatus: 'maintainer-reviewed',
    }],
  ]);

  const store = {
    async listLive({ limit, cursor }) {
      const ordered = [...records.values()].sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt) || right.jobId.localeCompare(left.jobId));
      const start = cursor == null ? 0 : ordered.findIndex((job) => job.lastSeenAt < cursor.lastSeenAt || (job.lastSeenAt === cursor.lastSeenAt && job.jobId < cursor.jobId));
      const page = ordered.slice(Math.max(0, start), Math.max(0, start) + limit + 1).map((job) => ({
        jobId: job.jobId,
        url: job.url,
        role: job.role,
        lastSeenAt: job.lastSeenAt,
        livenessStatus: job.livenessStatus,
        lastCheckedAt: job.lastCheckedAt,
        closedAt: job.closedAt,
      }));
      return { jobs: page.slice(0, limit), hasMore: page.length > limit };
    },
    async updateLiveness(jobId, patch) {
      const current = records.get(jobId);
      records.set(jobId, { ...current, livenessStatus: patch.status, lastCheckedAt: patch.checkedAt, closedAt: patch.closedAt });
    },
  };

  await runJobLivenessSweep({}, {
    store,
    now: new Date('2026-10-13T00:00:00.000Z'),
    fetchImpl: async (url) => {
      if (url.endsWith('/1')) {
        return Response.json({ id: 1, title: 'Open Role', absolute_url: 'https://job-boards.greenhouse.io/acme/jobs/1' });
      }
      return new Response('gone', { status: 404 });
    },
  });

  assert.equal(records.get('open-job').livenessStatus, 'open');
  assert.equal(records.get('open-job').closedAt, null);
  assert.equal(records.get('closed-job').livenessStatus, 'closed');
  assert.equal(records.get('closed-job').closedAt, '2026-09-01T00:00:00.000Z');
  assert.equal(records.get('closed-job').lastCheckedAt, '2026-10-13T00:00:00.000Z');
});
