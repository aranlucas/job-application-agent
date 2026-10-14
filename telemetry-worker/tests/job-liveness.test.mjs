import assert from 'node:assert/strict';
import test from 'node:test';

import {
  atsTarget,
  checkGenericHtmlLiveness,
  checkJobLiveness,
  isCareersIndexRedirect,
  runJobLivenessSweep,
} from '../src/job-liveness.mjs';

/** Real-shaped fixtures sampled from production /v1/jobs/live on 2026-10-14. */
const FIXTURES = {
  greenhouse_gitlab: {
    job: {
      jobId: 'community-job-aaaaaaaaaaaaaaaa',
      url: 'https://job-boards.greenhouse.io/gitlab/jobs/8826920002',
      role: 'Senior Frontend Engineer',
    },
    api: {
      id: 8826920002,
      title: 'Senior Frontend Engineer',
      absolute_url: 'https://job-boards.greenhouse.io/gitlab/jobs/8826920002',
    },
  },
  ashby_livekit: {
    job: {
      jobId: 'community-job-bbbbbbbbbbbbbbbb',
      url: 'https://jobs.ashbyhq.com/livekit/463e2769-bb85-4429-96a3-3a175eb228cd',
      role: 'Senior Product Engineer',
    },
    graphql: {
      data: {
        jobPosting: {
          id: '463e2769-bb85-4429-96a3-3a175eb228cd',
          title: 'Senior Product Engineer',
          isListed: true,
        },
      },
    },
  },
  lever_palantir: {
    job: {
      jobId: 'community-job-cccccccccccccccc',
      url: 'https://jobs.lever.co/palantir/2da4be12-bc7a-4950-87db-e9d68d955ff7',
      role: 'Full Stack Software Engineer - Application Development',
    },
    api: {
      id: '2da4be12-bc7a-4950-87db-e9d68d955ff7',
      text: 'Full Stack Software Engineer - Application Development',
      hostedUrl: 'https://jobs.lever.co/palantir/2da4be12-bc7a-4950-87db-e9d68d955ff7',
    },
  },
  workable_pavago: {
    job: {
      jobId: 'community-job-dddddddddddddddd',
      url: 'https://apply.workable.com/pavago/j/43A75F2D67',
      role: 'Senior Full Stack Software Engineer',
    },
    api: {
      id: 5832167,
      shortcode: '43A75F2D67',
      title: 'Senior Full Stack Software Engineer',
      state: 'published',
    },
  },
};

test('atsTarget parses real Greenhouse / Ashby / Lever / Workable URLs', () => {
  assert.deepEqual(atsTarget(FIXTURES.greenhouse_gitlab.job.url), {
    kind: 'greenhouse',
    id: '8826920002',
    url: 'https://boards-api.greenhouse.io/v1/boards/gitlab/jobs/8826920002',
  });
  const ashby = atsTarget(FIXTURES.ashby_livekit.job.url);
  assert.equal(ashby.kind, 'ashby');
  assert.equal(ashby.id, '463e2769-bb85-4429-96a3-3a175eb228cd');
  assert.equal(ashby.board, 'livekit');
  assert.match(ashby.url, /non-user-graphql/);
  assert.equal(atsTarget(FIXTURES.lever_palantir.job.url).kind, 'lever');
  assert.equal(atsTarget(FIXTURES.workable_pavago.job.url).kind, 'workable');
});

test('atsTarget accepts Ashby boards with spaces and Lever boards with dots', () => {
  const spaced = atsTarget('https://jobs.ashbyhq.com/Redesign%20Health/1a444c2a-c7da-4aa4-ac43-a23f22fae447');
  assert.equal(spaced?.kind, 'ashby');
  assert.equal(spaced.board, 'Redesign Health');
  assert.match(spaced.boardApiUrl, /Redesign%20Health/);

  const dotted = atsTarget('https://jobs.lever.co/trustedhousesitters.com/14bb1e36-724f-4dc6-96a8-d05e785ebe52');
  assert.equal(dotted?.kind, 'lever');
  assert.match(dotted.url, /trustedhousesitters\.com/);
});

test('greenhouse real-shaped 200 with matching title is open', async () => {
  const { job, api } = FIXTURES.greenhouse_gitlab;
  const result = await checkJobLiveness(job, {
    now: new Date('2026-10-14T12:00:00.000Z'),
    fetchImpl: async (url, init) => {
      assert.equal(url, 'https://boards-api.greenhouse.io/v1/boards/gitlab/jobs/8826920002');
      assert.equal(init.redirect, 'follow');
      assert.match(init.headers['user-agent'], /JobAppAgentLiveness/);
      return Response.json(api);
    },
  });
  assert.deepEqual(result, {
    status: 'open',
    checkedAt: '2026-10-14T12:00:00.000Z',
    reason: 'ats_open',
  });
});

test('ashby prefers single-job GraphQL over multi-MB board download', async () => {
  const { job, graphql } = FIXTURES.ashby_livekit;
  let boardFetched = false;
  const result = await checkJobLiveness(job, {
    now: new Date('2026-10-14T12:00:00.000Z'),
    fetchImpl: async (url, init) => {
      if (String(url).includes('non-user-graphql')) {
        assert.equal(init.method, 'POST');
        const body = JSON.parse(init.body);
        assert.equal(body.variables.organizationHostedJobsPageName, 'livekit');
        assert.equal(body.variables.jobPostingId, '463e2769-bb85-4429-96a3-3a175eb228cd');
        return Response.json(graphql);
      }
      boardFetched = true;
      return Response.json({ jobs: [] });
    },
  });
  assert.equal(boardFetched, false);
  assert.deepEqual(result, {
    status: 'open',
    checkedAt: '2026-10-14T12:00:00.000Z',
    reason: 'ats_open',
  });
});

test('ashby GraphQL null posting is closed; board fallback used when GraphQL errors', async () => {
  const job = FIXTURES.ashby_livekit.job;
  const closed = await checkJobLiveness(job, {
    now: new Date('2026-10-14T12:00:00.000Z'),
    fetchImpl: async (url) => {
      if (String(url).includes('non-user-graphql')) {
        return Response.json({ data: { jobPosting: null } });
      }
      throw new Error('should not hit board');
    },
  });
  assert.equal(closed.status, 'closed');
  assert.equal(closed.reason, 'ats_closed_missing');

  const fallback = await checkJobLiveness(job, {
    now: new Date('2026-10-14T12:00:00.000Z'),
    fetchImpl: async (url) => {
      if (String(url).includes('non-user-graphql')) {
        return Response.json({ errors: [{ message: 'schema boom' }] });
      }
      return Response.json({
        jobs: [{
          id: '463e2769-bb85-4429-96a3-3a175eb228cd',
          title: 'Senior Product Engineer',
          jobUrl: job.url,
          isListed: true,
        }],
      });
    },
  });
  assert.equal(fallback.status, 'open');
  assert.equal(fallback.reason, 'ats_open');
});

test('lever and workable real-shaped fixtures are open', async () => {
  const lever = await checkJobLiveness(FIXTURES.lever_palantir.job, {
    now: new Date('2026-10-14T12:00:00.000Z'),
    fetchImpl: async () => Response.json(FIXTURES.lever_palantir.api),
  });
  assert.equal(lever.status, 'open');
  assert.equal(lever.reason, 'ats_open');

  const workable = await checkJobLiveness(FIXTURES.workable_pavago.job, {
    now: new Date('2026-10-14T12:00:00.000Z'),
    fetchImpl: async () => Response.json(FIXTURES.workable_pavago.api),
  });
  assert.equal(workable.status, 'open');
  assert.equal(workable.reason, 'ats_open');
});

test('ATS fetch timeout / 403 / bad JSON surface reason codes as unknown', async () => {
  const job = FIXTURES.greenhouse_gitlab.job;
  const timeout = await checkJobLiveness(job, {
    now: new Date('2026-10-14T12:00:00.000Z'),
    fetchImpl: async () => {
      const error = new Error('The operation was aborted due to timeout');
      error.name = 'TimeoutError';
      throw error;
    },
  });
  assert.equal(timeout.status, 'unknown');
  assert.equal(timeout.reason, 'ats_timeout');

  const forbidden = await checkJobLiveness(job, {
    now: new Date('2026-10-14T12:00:00.000Z'),
    fetchImpl: async () => new Response('nope', { status: 403 }),
  });
  assert.equal(forbidden.status, 'unknown');
  assert.equal(forbidden.reason, 'ats_http_403');

  const badJson = await checkJobLiveness(job, {
    now: new Date('2026-10-14T12:00:00.000Z'),
    fetchImpl: async () => new Response('not-json', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  });
  assert.equal(badJson.status, 'unknown');
  assert.equal(badJson.reason, 'ats_bad_json');
});

test('greenhouse 404 is closed with reason', async () => {
  const result = await checkJobLiveness(FIXTURES.greenhouse_gitlab.job, {
    now: new Date('2026-10-14T12:00:00.000Z'),
    fetchImpl: async () => new Response('gone', { status: 404 }),
  });
  assert.deepEqual(result, {
    status: 'closed',
    checkedAt: '2026-10-14T12:00:00.000Z',
    reason: 'ats_http_404',
  });
});

test('title mismatch on a supported ATS is closed', async () => {
  const result = await checkJobLiveness({
    ...FIXTURES.greenhouse_gitlab.job,
    role: 'Staff Engineer',
  }, {
    now: new Date('2026-10-14T12:00:00.000Z'),
    fetchImpl: async () => Response.json({
      id: 8826920002,
      title: 'Completely Different Role',
      absolute_url: FIXTURES.greenhouse_gitlab.job.url,
    }),
  });
  assert.equal(result.status, 'closed');
  assert.equal(result.reason, 'ats_closed_title');
});

test('non-ATS host uses generic HTML check (200 + title = open)', async () => {
  const job = {
    jobId: 'community-job-eeeeeeeeeeeeeeee',
    url: 'https://careers.example.com/jobs/123-engineer',
    role: 'Staff Engineer',
  };
  const result = await checkJobLiveness(job, {
    now: new Date('2026-10-14T12:00:00.000Z'),
    fetchImpl: async (url, init) => {
      assert.equal(url, job.url);
      assert.equal(init.redirect, 'follow');
      return new Response('<html><title>Staff Engineer — Example</title><body>Apply now</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    },
  });
  assert.equal(result.status, 'open');
  assert.equal(result.reason, 'generic_open');
});

test('generic HTML 404/410 is closed', async () => {
  const job = {
    jobId: 'community-job-ffffffffffffffff',
    url: 'https://careers.example.com/jobs/gone',
    role: 'Engineer',
  };
  for (const status of [404, 410]) {
    const result = await checkGenericHtmlLiveness(job, {
      now: new Date('2026-10-14T12:00:00.000Z'),
      fetchImpl: async () => new Response('gone', { status }),
    });
    assert.equal(result.status, 'closed', `status ${status}`);
    assert.equal(result.reason, `generic_http_${status}`);
  }
});

test('generic HTML redirect to careers index is closed', async () => {
  assert.equal(
    isCareersIndexRedirect('https://careers.example.com/jobs/role-123', 'https://careers.example.com/careers'),
    true,
  );
  const job = {
    jobId: 'community-job-1111111111111111',
    url: 'https://careers.example.com/jobs/role-123',
    role: 'Engineer',
  };
  const result = await checkGenericHtmlLiveness(job, {
    now: new Date('2026-10-14T12:00:00.000Z'),
    fetchImpl: async () => {
      const response = new Response('', { status: 200 });
      Object.defineProperty(response, 'url', { value: 'https://careers.example.com/careers' });
      return response;
    },
  });
  assert.equal(result.status, 'closed');
  assert.equal(result.reason, 'generic_careers_redirect');
});

test('runJobLivenessSweep logs reason histogram and open/closed/unknown', async () => {
  const records = new Map([
    ['gh-open', {
      jobId: 'gh-open',
      url: FIXTURES.greenhouse_gitlab.job.url,
      role: FIXTURES.greenhouse_gitlab.job.role,
      lastSeenAt: '2026-10-12T00:00:00.000Z',
      livenessStatus: 'unknown',
      lastCheckedAt: null,
      closedAt: null,
      publicationStatus: 'published',
      reviewStatus: 'maintainer-reviewed',
    }],
    ['ashby-open', {
      jobId: 'ashby-open',
      url: FIXTURES.ashby_livekit.job.url,
      role: FIXTURES.ashby_livekit.job.role,
      lastSeenAt: '2026-10-11T00:00:00.000Z',
      livenessStatus: 'unknown',
      lastCheckedAt: null,
      closedAt: null,
      publicationStatus: 'published',
      reviewStatus: 'maintainer-reviewed',
    }],
  ]);
  const logs = [];
  const store = {
    async listDueForLivenessCheck({ limit }) {
      const page = [...records.values()].slice(0, limit);
      return { jobs: page, hasMore: false };
    },
    async updateLivenessBatch(patches) {
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
    limit: 10,
    now: new Date('2026-10-14T12:00:00.000Z'),
    log: (message) => logs.push(message),
    fetchImpl: async (url, init) => {
      if (String(url).includes('greenhouse')) return Response.json(FIXTURES.greenhouse_gitlab.api);
      if (String(url).includes('non-user-graphql')) {
        assert.equal(init.method, 'POST');
        return Response.json(FIXTURES.ashby_livekit.graphql);
      }
      return new Response('nope', { status: 500 });
    },
  });

  assert.equal(summary.checked, 2);
  assert.equal(summary.open, 2);
  assert.equal(summary.closed, 0);
  assert.equal(summary.unknown, 0);
  assert.equal(summary.reasons.ats_open, 2);
  assert.equal(records.get('gh-open').livenessStatus, 'open');
  assert.equal(records.get('ashby-open').livenessStatus, 'open');
  assert.match(logs[0], /checked=2 open=2 closed=0 unknown=0/);
  assert.match(logs[0], /ats_open=2/);
});
