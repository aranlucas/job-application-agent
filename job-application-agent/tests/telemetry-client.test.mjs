import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { prepareTelemetryInput, TelemetryClient } from '../scripts/telemetry-client.mjs';

function fakeRelay({ failTimes = 0 } = {}) {
  const requests = [];
  let failures = failTimes;
  const fetch = async (url, options = {}) => {
    requests.push({ url, options, body: options.body ? JSON.parse(options.body) : null });
    if (url.endsWith('/v1/install')) return Response.json({ installationId: '11111111-1111-4111-8111-111111111111', token: 'relay-token', expiresAt: '2099-01-01T00:00:00.000Z' });
    if (failures > 0) {
      failures -= 1;
      throw new Error('offline');
    }
    return Response.json({ accepted: true, eventId: '22222222-2222-4222-8222-222222222222' }, { status: 202 });
  };
  return { requests, fetch };
}

test('new installations disclose and send the first event immediately', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'telemetry-new-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const relay = fakeRelay();
  let notice = '';
  const client = new TelemetryClient({ stateDir: directory, endpoint: 'https://relay.example.com', fetch: relay.fetch, stderr: (value) => { notice += value; } });
  const session = await client.beginCommand('search');
  assert.equal(session.installationEventPending, true);
  assert.equal(session.allowSend, true);
  await client.record({ event: 'installation_started', properties: { osFamily: 'macos', nodeMajor: 24, submissionMode: 'unconfigured' } }, session);
  const result = await client.record({ event: 'command_completed', properties: { command: 'search', result: 'success', durationBucket: '1-5s' } }, session);
  assert.match(notice, /usage analytics/i);
  assert.equal(result.sent, true);
  assert.equal(relay.requests.length, 3);
  assert.equal((await client.beginCommand('search')).installationEventPending, false);
  if (process.platform !== 'win32') assert.equal((await stat(join(directory, 'telemetry.json'))).mode & 0o777, 0o600);
});

test('existing installations without telemetry.json send immediately including the install event', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'telemetry-existing-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'applications.ndjson'), '{"private":"historical"}\n');
  const relay = fakeRelay();
  const client = new TelemetryClient({ stateDir: directory, endpoint: 'https://relay.example.com', fetch: relay.fetch, stderr: () => {} });
  const firstSession = await client.beginCommand('search');
  assert.equal(firstSession.installationEventPending, true);
  assert.equal(firstSession.allowSend, true);
  assert.equal((await client.record({ event: 'installation_started', properties: { osFamily: 'linux', nodeMajor: 22, submissionMode: 'unconfigured' } }, firstSession)).sent, true);
  assert.equal((await client.record({ event: 'command_completed', properties: { command: 'search', result: 'success', durationBucket: 'under-1s' } }, firstSession)).sent, true);
  assert.ok(relay.requests.length >= 3);
});

test('disclosure no longer drops the first command after the notice', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'telemetry-grace-removed-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'telemetry.json'), JSON.stringify({ version: 1, enabled: true, disclosed: false, graceConsumed: false, installationEventPending: false }));
  const relay = fakeRelay();
  let notice = '';
  const client = new TelemetryClient({ stateDir: directory, endpoint: 'https://relay.example.com', fetch: relay.fetch, stderr: (value) => { notice += value; } });
  const session = await client.beginCommand('search');
  assert.match(notice, /usage analytics/i);
  assert.equal(session.allowSend, true);
  assert.equal((await client.record({ event: 'command_completed', properties: { command: 'search', result: 'success', durationBucket: 'under-1s' } }, session)).sent, true);
  assert.ok(relay.requests.length >= 2);
});

test('corrupt telemetry.json is treated as enabled unless an explicit opt-out exists', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'telemetry-corrupt-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'telemetry.json'), '{not-json');
  const relay = fakeRelay();
  const client = new TelemetryClient({ stateDir: directory, endpoint: 'https://relay.example.com', fetch: relay.fetch, stderr: () => {}, debug: () => {} });
  const session = await client.beginCommand('search');
  assert.equal(session.enabled, true);
  assert.equal(session.allowSend, true);
  assert.equal((await client.status()).enabled, true);
  const rewritten = JSON.parse(await readFile(join(directory, 'telemetry.json'), 'utf8'));
  assert.equal(rewritten.enabled, true);
  assert.equal((await client.record({ event: 'command_completed', properties: { command: 'search', result: 'success', durationBucket: 'under-1s' } }, session)).sent, true);
});

test('explicit opt-out file and env var keep telemetry disabled', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'telemetry-optout-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'telemetry.opt-out'), 'opted-out\n');
  const relay = fakeRelay();
  const client = new TelemetryClient({ stateDir: directory, endpoint: 'https://relay.example.com', fetch: relay.fetch, stderr: () => {} });
  assert.equal((await client.beginCommand('search')).allowSend, false);
  const envClient = new TelemetryClient({
    stateDir: await mkdtemp(join(tmpdir(), 'telemetry-env-')),
    endpoint: 'https://relay.example.com',
    fetch: relay.fetch,
    stderr: () => {},
    env: { JOB_APPLICATION_AGENT_TELEMETRY_DISABLED: '1' },
  });
  assert.equal((await envClient.beginCommand('search')).enabled, false);
});

test('disable preserves installation id while reset removes it and keeps telemetry disabled', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'telemetry-controls-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const relay = fakeRelay();
  const client = new TelemetryClient({ stateDir: directory, endpoint: 'https://relay.example.com', fetch: relay.fetch, stderr: () => {} });
  const session = await client.beginCommand('search');
  await client.record({ event: 'command_completed', properties: { command: 'search', result: 'success', durationBucket: 'under-1s' } }, session);
  const disabled = await client.configure('disable');
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.hasInstallationId, true);
  await client.configure('enable');
  const resumed = await client.beginCommand('search');
  await client.record({ event: 'command_completed', properties: { command: 'search', result: 'success', durationBucket: 'under-1s' } }, resumed);
  assert.equal(relay.requests.filter((request) => request.url.endsWith('/v1/install')).length, 1);
  const reset = await client.configure('reset');
  assert.equal(reset.enabled, false);
  assert.equal(reset.hasInstallationId, false);
  assert.equal((await client.status()).enabled, false);
});

test('failed sends are queued and retried on the next command without marking the session unavailable forever', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'telemetry-queue-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const logs = [];
  const relay = fakeRelay({ failTimes: 3 });
  const client = new TelemetryClient({
    stateDir: directory,
    endpoint: 'https://relay.example.com',
    fetch: relay.fetch,
    stderr: () => {},
    debug: (value) => { logs.push(value); },
    timeoutMs: 50,
  });
  const session = await client.beginCommand('apply');
  const first = await client.record({ event: 'application_paused', properties: { jobHash: 'a'.repeat(64), ats: 'lever', stage: 'legal', reason: 'legal' } }, session);
  assert.equal(first.sent, false);
  assert.equal(first.reason, 'unavailable');
  assert.equal(session.unavailable, undefined);
  const second = await client.record({ event: 'command_completed', properties: { command: 'apply', result: 'paused', durationBucket: 'under-1s' } }, session);
  assert.equal(second.sent, true);
  await client.beginCommand('apply');
  const queue = await readFile(join(directory, 'telemetry-queue.ndjson'), 'utf8').catch(() => '');
  assert.equal(queue.trim(), '');
  assert.ok(logs.some((line) => /queued event=application_paused/i.test(line)));
});

test('preview validates but never transmits and network failures never escape', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'telemetry-preview-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const client = new TelemetryClient({ stateDir: directory, endpoint: 'https://relay.example.com', fetch: async () => { throw new Error('offline'); }, stderr: () => {}, timeoutMs: 20 });
  const event = { event: 'application_paused', properties: { jobHash: 'a'.repeat(64), ats: 'lever', stage: 'legal', reason: 'legal' } };
  assert.equal((await client.preview(event)).event, 'application_paused');
  const session = await client.beginCommand('apply');
  assert.deepEqual(await client.record(event, session), { sent: false, reason: 'unavailable' });
});

test('converts a transient job URL to a hash and domain before validation', async () => {
  const event = await prepareTelemetryInput({
    event: 'application_paused',
    properties: { jobUrl: 'https://jobs.example.com/role/123?email=candidate@example.com', ats: 'ashby', stage: 'legal', reason: 'legal' },
  });
  assert.equal(event.properties.domain, undefined);
  assert.equal(event.properties.jobHash.length, 64);
  assert.equal(JSON.stringify(event).includes('candidate@example.com'), false);
});

test('record input rejects undocumented top-level properties', async () => {
  await assert.rejects(() => prepareTelemetryInput({
    event: 'command_completed',
    properties: { command: 'search', result: 'success', durationBucket: 'under-1s' },
    prompt: 'private free-form content',
  }), /unknown/i);
});

test('strict record rejects invalid schema while automatic telemetry emits a schema_invalid counter', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'telemetry-strict-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const relay = fakeRelay();
  const logs = [];
  const client = new TelemetryClient({ stateDir: directory, endpoint: 'https://relay.example.com', fetch: relay.fetch, stderr: () => {}, debug: (value) => { logs.push(value); } });
  const session = await client.beginCommand('telemetry');
  const invalid = { event: 'command_completed', properties: { command: 'search', result: 'success', durationBucket: 'raw private value' } };
  await assert.rejects(() => client.record(invalid, session, { strict: true }), /durationBucket/i);
  assert.deepEqual(await client.record(invalid, session), { sent: false, reason: 'invalid' });
  assert.ok(logs.some((line) => /schema-invalid/i.test(line)));
  const counter = relay.requests.map((request) => request.body).find((body) => body?.event === 'skill_error');
  assert.equal(counter?.properties?.errorCategory, 'schema_invalid');
  assert.equal(counter?.properties?.sanitizedMessage, undefined);
});

const usageEvent = { event: 'command_completed', properties: { command: 'profile', result: 'success', durationBucket: 'under-1s' } };

test('candidate identity is never attached to analytics events', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'telemetry-no-identity-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const relay = fakeRelay();
  const client = new TelemetryClient({
    stateDir: directory,
    fetch: relay.fetch,
    stderr: () => {},
    readIdentity: () => ({ name: 'Test Candidate', email: 'candidate@example.com' }),
  });
  await client.record(usageEvent, await client.beginCommand('profile'));
  await client.record(usageEvent, await client.beginCommand('profile'));
  assert.ok(relay.requests.every((request) => request.body?.identity === undefined));
  assert.equal(JSON.stringify(relay.requests).includes('candidate@example.com'), false);
  assert.equal(JSON.stringify(relay.requests).includes('Test Candidate'), false);
  assert.equal((await client.status()).identityEnabled, false);
});

test('identity controls remain available but never enable identity payloads', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'telemetry-identity-control-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const relay = fakeRelay();
  const client = new TelemetryClient({ stateDir: directory, fetch: relay.fetch, stderr: () => {}, readIdentity: () => ({ name: 'Test Candidate', email: 'candidate@example.com' }) });
  await client.beginCommand('profile');
  const status = await client.configureIdentity('disable');
  assert.equal(status.identityEnabled, false);
  await client.record(usageEvent, await client.beginCommand('profile'));
  assert.equal(relay.requests.at(-1).body.identity, undefined);
  const enabled = await client.configureIdentity('enable');
  assert.equal(enabled.identityEnabled, false);
  await client.record(usageEvent, await client.beginCommand('profile'));
  assert.equal(relay.requests.at(-1).body.identity, undefined);
});
