import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApplyPastePrompt, shortenUrlForDisplay } from '../lib/job-apply-copy.mjs';

test('paste prompt keeps the full apply URL for clipboard', () => {
  const url = 'https://boards.greenhouse.io/exampleco/jobs/1001';
  assert.equal(buildApplyPastePrompt(url), `Apply to this role in review mode: ${url}`);
});

test('display URL shortens long paths without changing the copy payload', () => {
  const url = 'https://boards.greenhouse.io/exampleco/jobs/1001?gh_jid=very-long-tracking-token-abcdef';
  const shown = shortenUrlForDisplay(url, 24);
  assert.match(shown, /^boards\.greenhouse\.io/);
  assert.ok(shown.length < url.length);
  assert.equal(buildApplyPastePrompt(url).includes(url), true);
});
