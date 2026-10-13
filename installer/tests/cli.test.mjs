import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runCli } from '../src/cli.mjs';

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'job-agent-cli-'));
  const packageRoot = path.join(root, 'package');
  const agentHome = path.join(root, '.agents');
  await mkdir(path.join(packageRoot, 'job-application-agent', 'scripts'), { recursive: true });
  await writeFile(path.join(packageRoot, 'job-application-agent', 'SKILL.md'), '# Skill\n');
  await writeFile(path.join(packageRoot, 'job-application-agent', 'scripts', 'job-application.mjs'), 'export {};\n');
  return { root, packageRoot, agentHome };
}

test('install is automatic-update enabled by default and status reports the installed version', async () => {
  const f = await setup();
  const output = [];
  await runCli(['install'], { packageRoot: f.packageRoot, packageVersion: '3.0.0', agentHome: f.agentHome, homeDir: f.root, platform: 'test', scheduler: false, output: value => output.push(value) });
  await runCli(['status'], { agentHome: f.agentHome, homeDir: f.root, output: value => output.push(value) });
  assert.match(output.join('\n'), /3\.0\.0/);
  assert.match(output.join('\n'), /automatic updates: enabled/i);
});

test('auto-update is a no-op when updates are disabled', async () => {
  const f = await setup();
  await runCli(['install'], { packageRoot: f.packageRoot, packageVersion: '3.0.0', agentHome: f.agentHome, homeDir: f.root, platform: 'test', scheduler: false, output: () => {} });
  await runCli(['updates', 'disable'], { agentHome: f.agentHome, homeDir: f.root, platform: 'test', scheduler: false, output: () => {} });
  await writeFile(path.join(f.packageRoot, 'job-application-agent', 'SKILL.md'), '# New skill\n');
  const output = [];
  await runCli(['auto-update'], { packageRoot: f.packageRoot, packageVersion: '3.1.0', agentHome: f.agentHome, homeDir: f.root, platform: 'test', scheduler: false, output: value => output.push(value) });
  assert.match(output.join('\n'), /disabled/i);
  assert.equal(await readFile(path.join(f.agentHome, 'skills', 'job-application-agent', 'SKILL.md'), 'utf8'), '# Skill\n');
});

test('auto-update does not replace an already-current installation or reload its scheduler', async () => {
  const f = await setup();
  await runCli(['install'], { packageRoot: f.packageRoot, packageVersion: '3.0.0', agentHome: f.agentHome, homeDir: f.root, platform: 'test', scheduler: false, output: () => {} });
  const marker = path.join(f.agentHome, 'skills', 'job-application-agent', 'local-marker');
  await writeFile(marker, 'preserve');
  const output = [];
  await runCli(['auto-update'], { packageRoot: f.packageRoot, packageVersion: '3.0.0', agentHome: f.agentHome, homeDir: f.root, platform: 'darwin', output: value => output.push(value) });
  assert.equal(await readFile(marker, 'utf8'), 'preserve');
  assert.match(output.join('\n'), /already current/i);
});

test('auto-update replaces an older skill without reloading the running scheduler', async () => {
  const f = await setup();
  await runCli(['install'], { packageRoot: f.packageRoot, packageVersion: '3.0.0', agentHome: f.agentHome, homeDir: f.root, platform: 'test', scheduler: false, output: () => {} });
  await writeFile(path.join(f.packageRoot, 'job-application-agent', 'SKILL.md'), '# New skill\n');
  await runCli(['auto-update'], { packageRoot: f.packageRoot, packageVersion: '3.1.0', agentHome: f.agentHome, homeDir: f.root, platform: 'darwin', output: () => {} });
  assert.equal(await readFile(path.join(f.agentHome, 'skills', 'job-application-agent', 'SKILL.md'), 'utf8'), '# New skill\n');
});

test('unknown commands fail with usage instead of silently installing', async () => {
  const f = await setup();
  await assert.rejects(runCli(['surprise'], { packageRoot: f.packageRoot, packageVersion: '3.0.0', agentHome: f.agentHome, output: () => {} }), /usage/i);
});

test('apply with a valid https URL prints the review-mode prompt', async () => {
  const f = await setup();
  const url = 'https://jobs.example.com/boards/acme/jobs/123';
  const output = [];
  const logs = [];
  const result = await runCli(['apply', url], {
    packageRoot: f.packageRoot,
    packageVersion: '3.0.0',
    agentHome: f.agentHome,
    homeDir: f.root,
    env: {},
    log: (message) => logs.push(message),
    output: (value) => output.push(value),
  });
  const text = output.join('\n');
  assert.match(text, /review mode/i);
  assert.match(text, /do not submit/i);
  assert.match(text, /approval/i);
  assert.match(text, /Never auto-submit/i);
  assert.match(text, new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(text, /npx job-application-agent@latest install/);
  assert.match(text, /review mode required/i);
  assert.equal(result.reviewMode, true);
  assert.equal(result.url, url);
  assert.equal(result.applyKind, 'live');
  assert.equal(result.liveApply, true);
  assert.match(logs.join('\n'), /LIVE_APPLY/);
});

test('apply without a URL fails with usage', async () => {
  const f = await setup();
  await assert.rejects(
    runCli(['apply'], { packageRoot: f.packageRoot, packageVersion: '3.0.0', agentHome: f.agentHome, output: () => {} }),
    /usage/i,
  );
});

test('apply with an invalid URL fails', async () => {
  const f = await setup();
  await assert.rejects(
    runCli(['apply', 'not-a-url'], { packageRoot: f.packageRoot, packageVersion: '3.0.0', agentHome: f.agentHome, output: () => {} }),
    /invalid apply url/i,
  );
  await assert.rejects(
    runCli(['apply', 'http://jobs.example.com/role'], { packageRoot: f.packageRoot, packageVersion: '3.0.0', agentHome: f.agentHome, output: () => {} }),
    /must be https/i,
  );
  await assert.rejects(
    runCli(['apply', 'https://user:secret@jobs.example.com/role'], { packageRoot: f.packageRoot, packageVersion: '3.0.0', agentHome: f.agentHome, output: () => {} }),
    /username or password/i,
  );
});

test('apply with launchPrompt returns structured result without printing', async () => {
  const f = await setup();
  const url = 'https://boards.greenhouse.io/acme/jobs/42';
  const output = [];
  const result = await runCli(['apply', url], {
    packageRoot: f.packageRoot,
    packageVersion: '3.0.0',
    agentHome: f.agentHome,
    homeDir: f.root,
    env: {},
    log: () => {},
    launchPrompt: true,
    output: (value) => output.push(value),
  });
  assert.equal(output.length, 0);
  assert.equal(result.reviewMode, true);
  assert.equal(result.url, url);
  assert.match(result.prompt, /review mode/i);
  assert.match(result.prompt, /Never auto-submit/);
  assert.match(result.confirmation, /review mode required/i);
});
