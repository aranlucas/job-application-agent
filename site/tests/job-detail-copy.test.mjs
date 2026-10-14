import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApplyCliCommand, buildApplyPastePrompt, shortenUrlForDisplay } from '../lib/job-apply-copy.mjs';

test('paste prompt keeps the full apply URL for clipboard', () => {
  const url = 'https://job-boards.greenhouse.io/exampleco/jobs/1001';
  assert.equal(buildApplyPastePrompt(url), `Apply to this role in review mode: ${url}`);
});

test('apply CLI command keeps the full URL for clipboard', () => {
  const url = 'https://job-boards.greenhouse.io/exampleco/jobs/1001';
  assert.equal(buildApplyCliCommand(url), `npx job-application-agent@latest apply ${url}`);
});

test('shortenUrlForDisplay clips long paths but keeps host', () => {
  const url = 'https://job-boards.greenhouse.io/exampleco/jobs/1001-with-a-very-long-path-suffix';
  const short = shortenUrlForDisplay(url, 20);
  assert.match(short, /^job-boards\.greenhouse\.io/);
  assert.ok(short.length < url.length);
});
