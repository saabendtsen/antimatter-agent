import test from 'node:test';
import assert from 'node:assert/strict';
import { resumeRecord, sourceProvenance } from '../src/provenance.js';

const SHA = '715e63bac34fa7f387248321617650eda902abf9';

function fakeGit(outputs) {
  const calls = [];
  const run = (program, args, options) => {
    calls.push({ program, args, options });
    const out = outputs[args[0]];
    if (out instanceof Error) return { error: out, status: null, stdout: '' };
    if (out === undefined) return { status: 128, stdout: '' };
    return { status: 0, stdout: out };
  };
  return { run, calls };
}

test('provenance records the git commit and whether tracked files differ from it', () => {
  const clean = fakeGit({ 'rev-parse': `${SHA}\n`, status: '' });
  assert.deepEqual(sourceProvenance({ run: clean.run, env: {} }), { commit: SHA, dirty: false, source: 'git' });
  assert.equal(clean.calls[0].program, 'git');
  assert.equal(clean.calls[0].options.shell, false, 'git runs without a shell');
  const dirty = fakeGit({ 'rev-parse': SHA, status: ' M src/agent.js\n' });
  assert.equal(sourceProvenance({ run: dirty.run, env: {} }).dirty, true);
});

test('missing git gives explicit unknown provenance instead of failing the controller', () => {
  const missing = fakeGit({ 'rev-parse': Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' }) });
  assert.deepEqual(sourceProvenance({ run: missing.run, env: {} }),
    { commit: null, dirty: null, source: 'unknown', reason: 'git_unavailable' });
  const notRepo = fakeGit({});
  assert.equal(sourceProvenance({ run: notRepo.run, env: {} }).source, 'unknown');
  const throws = () => { throw new Error('boom'); };
  assert.equal(sourceProvenance({ run: throws, env: {} }).reason, 'git_unavailable');
  const odd = fakeGit({ 'rev-parse': 'not a commit' });
  assert.equal(sourceProvenance({ run: odd.run, env: {} }).reason, 'git_unrecognised');
});

test('a packaged run may declare its commit, but only a well-formed one', () => {
  const missing = fakeGit({});
  assert.deepEqual(sourceProvenance({ run: missing.run, env: { ANTIMATTER_SOURCE_COMMIT: SHA.toUpperCase() } }),
    { commit: SHA, dirty: null, source: 'env' });
  assert.equal(sourceProvenance({ run: missing.run, env: { ANTIMATTER_SOURCE_COMMIT: 'main; rm -rf /' } }).source, 'unknown');
});

test('the real repository yields a commit or explicit unknown, never an exception', () => {
  const result = sourceProvenance({ cwd: new URL('..', import.meta.url) });
  assert.ok(['git', 'env', 'unknown'].includes(result.source));
  if (result.source === 'git') assert.match(result.commit, /^[0-9a-f]{40}$/);
});

// Pre-pilot run 2 was resumed by hand on 2026-09-26 after a block, and the operator had to write the
// commit into an event themselves. A controller restart now records it together with the pause.
test('a resumed run records current and previous commits and the gap since its last event', () => {
  const run = { status: 'active', round: 6, harness: { commit: 'a'.repeat(40), dirty: false, source: 'git' } };
  const harness = { commit: SHA, dirty: false, source: 'git' };
  const record = resumeRecord({ run, previousHarness: { commit: 'b'.repeat(40) }, harness,
    lastEvent: { at: '2026-09-26T22:10:19.052Z', type: 'run_blocked' }, now: Date.parse('2026-09-26T22:11:30.376Z') });
  assert.deepEqual(record, { type: 'controller_resume', status: 'active', roundsPlayed: 6, harness,
    previousCommit: 'b'.repeat(40), runStartCommit: 'a'.repeat(40), commitChanged: true,
    lastEventType: 'run_blocked', lastEventAt: '2026-09-26T22:10:19.052Z', gapSeconds: 71 });
  assert.equal(record.round, undefined, 'the resume is not attributed to a round in retrospective evidence');
});

test('a resume with unknown provenance or no prior events says so rather than guessing', () => {
  const record = resumeRecord({ run: { status: 'retrospective', round: 7 }, previousHarness: null,
    harness: { commit: null, dirty: null, source: 'unknown', reason: 'git_unavailable' }, lastEvent: undefined });
  assert.equal(record.previousCommit, null);
  assert.equal(record.runStartCommit, null);
  assert.equal(record.commitChanged, null);
  assert.equal(record.gapSeconds, null);
  assert.equal(record.harness.source, 'unknown');
});
