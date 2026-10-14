import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkGenericHtmlLiveness,
  checkJobLiveness,
  isCareersIndexRedirect,
  runJobLivenessSweep,
} from '../src/job-liveness.mjs';

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

test('non-ATS host uses generic HTML check (200 + title = open)', async () => {
  const job = {
    jobId: 'community-job-cccccccccccccccc',
    url: 'https://careers.example.com/jobs/123-engineer',
    role: 'Staff Engineer',
  };
  let fetched = false;
  const result = await checkJobLiveness(job, {
    now: new Date('2026-10-13T12:00:00.000Z'),
    fetchImpl: async (url, init) => {
      fetched = true;
      assert.equal(url, job.url);
      assert.equal(init.redirect, 'follow');
      return new Response('<html><title>Staff Engineer — Example</title><body>Apply now</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    },
  });
  assert.equal(fetched, true);
  assert.deepEqual(result, { status: 'open', checkedAt: '2026-10-13T12:00:00.000Z' });
});

test('generic HTML 404/410 is closed', async () => {
  const job = {
    jobId: 'community-job-dddddddddddddddd',
    url: 'https://careers.example.com/jobs/gone',
    role: 'Engineer',
  };
  for (const status of [404, 410]) {
    const result = await checkGenericHtmlLiveness(job, {
      now: new Date('2026-10-13T12:00:00.000Z'),
      fetchImpl: async () => new Response('gone', { status }),
    });
    assert.equal(result.status, 'closed', `status ${status}`);
  }
});

test('generic HTML redirect to careers index is closed', async () => {
  assert.equal(
    isCareersIndexRedirect('https://careers.example.com/jobs/role-123', 'https://careers.example.com/careers'),
    true,
  );
  assert.equal(
    isCareersIndexRedirect('https://careers.example.com/jobs/role-123', 'https://careers.example.com/jobs/role-123'),
    false,
  );

  const job = {
    jobId: 'community-job-eeeeeeeeeeeeeeee',
    url: 'https://careers.example.com/jobs/role-123',
    role: 'Engineer',
  };
  const result = await checkGenericHtmlLiveness(job, {
    now: new Date('2026-10-13T12:00:00.000Z'),
    fetchImpl: async () => {
      const response = new Response('', { status: 200 });
      Object.defineProperty(response, 'url', { value: 'https://careers.example.com/careers' });
      return response;
    },
  });
  assert.equal(result.status, 'closed');
});

test('generic HTML without role title stays unknown', async () => {
  const job = {
    jobId: 'community-job-ffffffffffffffff',
    url: 'https://careers.example.com/jobs/123',
    role: 'Staff Platform Engineer',
  };
  const result = await checkGenericHtmlLiveness(job, {
    now: new Date('2026-10-13T12:00:00.000Z'),
    fetchImpl: async () => new Response('<html><body>Welcome to our careers site</body></html>', { status: 200 }),
  });
  assert.equal(result.status, 'unknown');
});

test('network errors leave liveness unknown', async () => {
  const job = {
    jobId: 'community-job-1111111111111111',
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
    jobId: 'community-job-2222222222222222',
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

test('runJobLivenessSweep batches oldest-checked jobs and logs open/closed/unknown', async () => {
  const records = new Map([
    ['unchecked-job', {
      jobId: 'unchecked-job',
      url: 'https://job-boards.greenhouse.io/acme/jobs/1',
      role: 'Open Role',
      lastSeenAt: '2026-10-12T00:00:00.000Z',
      livenessStatus: 'unknown',
      lastCheckedAt: null,
      closedAt: null,
      publicationStatus: 'published',
      reviewStatus: 'maintainer-reviewed',
    }],
    ['fresh-job', {
      jobId: 'fresh-job',
      url: 'https://careers.example.com/jobs/skip-me',
      role: 'Skip Role',
      lastSeenAt: '2026-10-13T00:00:00.000Z',
      livenessStatus: 'open',
      lastCheckedAt: '2026-10-13T00:00:00.000Z',
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

  const batchWrites = [];
  const logs = [];
  const store = {
    async listDueForLivenessCheck({ limit }) {
      const ordered = [...records.values()].sort((left, right) => {
        if (left.lastCheckedAt == null && right.lastCheckedAt != null) return -1;
        if (left.lastCheckedAt != null && right.lastCheckedAt == null) return 1;
        if (left.lastCheckedAt != null && right.lastCheckedAt != null && left.lastCheckedAt !== right.lastCheckedAt) {
          return left.lastCheckedAt.localeCompare(right.lastCheckedAt);
        }
        return left.jobId.localeCompare(right.jobId);
      });
      const page = ordered.slice(0, limit + 1).map((job) => ({
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
    async updateLivenessBatch(patches) {
      batchWrites.push(patches);
      for (const patch of patches) {
        const current = records.get(patch.jobId);
        records.set(patch.jobId, {
          ...current,
          livenessStatus: patch.status,
          lastCheckedAt: patch.checkedAt,
          closedAt: patch.closedAt,
        });
      }
    },
  };

  const summary = await runJobLivenessSweep({}, {
    store,
    limit: 2,
    now: new Date('2026-10-13T00:00:00.000Z'),
    log: (message) => logs.push(message),
    fetchImpl: async (url) => {
      if (String(url).endsWith('/1')) {
        return Response.json({ id: 1, title: 'Open Role', absolute_url: 'https://job-boards.greenhouse.io/acme/jobs/1' });
      }
      return new Response('gone', { status: 404 });
    },
  });

  assert.equal(summary.checked, 2);
  assert.equal(summary.open, 1);
  assert.equal(summary.closed, 1);
  assert.equal(summary.unknown, 0);
  assert.equal(summary.hasMore, true);
  assert.equal(batchWrites.length, 1);
  assert.equal(batchWrites[0].length, 2);
  assert.equal(records.get('unchecked-job').livenessStatus, 'open');
  assert.equal(records.get('closed-job').livenessStatus, 'closed');
  assert.equal(records.get('closed-job').closedAt, '2026-09-01T00:00:00.000Z');
  assert.equal(records.get('fresh-job').lastCheckedAt, '2026-10-13T00:00:00.000Z');
  assert.match(logs[0], /checked=2 open=1 closed=1 unknown=0 hasMore=true/);
});
