import test from 'node:test';
import assert from 'node:assert/strict';
import { gameMetrics, HARNESS_ERROR_SUMMARY, harnessFailure, publicCurrent, publicState, retrospectiveEvidence } from '../src/controller.js';

// The public state left over when pre-pilot run 3 started on 2026-09-26: run 2's last round-end view.
const run2Round7 = { run: 2, round: 7, phase: 'waiting', summary: 'Saved for tickspeed.', pageText: 'You have 5 K antimatter.',
  screenshot: 'screen.png?v=111', nextWakeAt: null, antimatter: '5 K', production: '20' };

function control(runs) {
  return { mode: 'prepilot', status: 'active', runs };
}

const threeRuns = control([{ status: 'complete', round: 30 }, { status: 'complete', round: 7 }, { status: 'active', round: 0 }]);

test('a new playthrough replaces the prior run instead of inheriting its screenshot, text and decision', () => {
  const current = publicCurrent(threeRuns, { run: 3, round: null, phase: 'starting' }, run2Round7);
  assert.deepEqual(current, { run: 3, round: null, phase: 'starting', roundStartedAt: null, roundEndsBy: null,
    summary: '', pageText: '', screenshot: null, nextWakeAt: null, antimatter: null, production: null });
});

test('a republish with no update never presents an older run as current', () => {
  // A controller restart after run 3 was created, but before it published, must still show run 3.
  const current = publicCurrent(threeRuns, {}, run2Round7);
  assert.equal(current.run, 3);
  assert.equal(current.round, null);
  assert.equal(current.screenshot, null);
  assert.equal(current.pageText, '');
  assert.equal(current.summary, '');
  const resumed = publicCurrent(control([{ status: 'complete', round: 30 }, { status: 'active', round: 7 }]), {}, run2Round7);
  assert.equal(resumed.round, 7, 'the same run keeps its public state');
  assert.equal(resumed.screenshot, 'screen.png?v=111');
});

test('a round start shows the new observation and keeps only the same run\'s last decision', () => {
  const current = publicCurrent(control([{ status: 'active', round: 8 }, { status: 'active', round: 8 }]), {
    run: 2, round: 8, phase: 'playing', nextWakeAt: null, roundStartedAt: '2026-09-26T22:00:00.000Z',
    roundEndsBy: '2026-09-26T22:18:00.000Z', pageText: 'You have 9 K antimatter.', screenshot: 'screen.png?v=222',
    antimatter: '9 K', production: '30' }, { ...run2Round7, nextWakeAt: '2026-09-26T21:59:00.000Z' });
  assert.equal(current.round, 8);
  assert.equal(current.phase, 'playing');
  assert.equal(current.summary, 'Saved for tickspeed.');
  assert.equal(current.screenshot, 'screen.png?v=222');
  assert.equal(current.pageText, 'You have 9 K antimatter.');
  assert.equal(current.nextWakeAt, null);
  assert.equal(current.roundEndsBy, '2026-09-26T22:18:00.000Z');
});

test('public text stays bounded and free of control characters', () => {
  const current = publicCurrent(threeRuns, { run: 3, summary: `a\u0000b${'x'.repeat(2000)}`, pageText: 'y'.repeat(9000) });
  assert.equal(current.summary.length, 1000);
  assert.equal(current.summary.slice(0, 3), 'a b');
  assert.equal(current.pageText.length, 6000);
});

test('game metrics are read from visible page text', () => {
  assert.deepEqual(gameMetrics('You have 1.5e10 antimatter.\nYou are getting 3 K antimatter per second.'),
    { antimatter: '1.5e10', production: '3 K' });
  assert.deepEqual(gameMetrics(''), { antimatter: null, production: null });
});


test('a harness failure keeps its paths, model URL and endpoint out of the public state', () => {
  const secretPath = 'C:\Dev\secret-checkout\state\soak\run-01\browser-profile';
  const secretUrl = 'http://10.20.30.40:8081/v1/chat/completions';
  const error = new Error(`fetch failed for ${secretUrl} while opening ${secretPath}`);
  error.stack = `${error.message}\n    at playRound (${secretPath}\agent.js:12:3)`;
  const failure = harnessFailure(error, 5);
  assert.equal(failure.event.type, 'harness_error');
  assert.match(failure.event.message, /10\.20\.30\.40:8081/, 'the private event keeps the full details');
  assert.match(failure.event.message, /secret-checkout/);
  assert.equal(failure.outcome.summary, HARNESS_ERROR_SUMMARY);
  assert.equal(failure.outcome.incomplete, true);

  const events = [{ at: '2026-09-27T10:00:00.000Z', type: 'round_start', round: 5 }, failure.event,
    { at: '2026-09-27T10:00:01.000Z', type: 'round_end', round: 5, ...failure.outcome, appliedWakeSeconds: 60 }];
  const state = control([{ status: 'active', round: 5, startedAt: '2026-09-27T09:00:00.000Z', inheritedHandoff: '' }]);
  const published = JSON.stringify(publicState(state, { run: 1, round: 5, phase: 'waiting', summary: failure.outcome.summary },
    {}, () => events));
  for (const secret of ['10.20.30.40', '8081', '/v1/chat', 'secret-checkout', 'browser-profile', 'fetch failed', 'agent.js']) {
    assert.ok(!published.includes(secret), `public state leaked ${secret}`);
  }
  assert.ok(published.includes(HARNESS_ERROR_SUMMARY));
});

test('an old-format harness error summary is read back as the generic summary', () => {
  const oldSummary = 'Harness error: fetch failed for http://192.168.1.50:8081/v1/chat/completions at C:\Dev\private-checkout\state\soak\run-01';
  const events = [{ at: '2026-09-27T10:00:00.000Z', type: 'round_start', round: 3 },
    { at: '2026-09-27T10:00:01.000Z', type: 'round_end', round: 3, summary: oldSummary, nextWakeSeconds: 60, appliedWakeSeconds: 60, incomplete: true },
    { at: '2026-09-27T10:01:00.000Z', type: 'round_start', round: 4 },
    { at: '2026-09-27T10:01:01.000Z', type: 'round_end', round: 4, summary: 'Harness error was mentioned; bought tickspeed.', nextWakeSeconds: 30, appliedWakeSeconds: 30 }];
  const state = control([{ status: 'active', round: 4, startedAt: '2026-09-27T09:00:00.000Z', inheritedHandoff: '' }]);
  const published = publicState(state, {}, {}, () => events);
  const evidence = retrospectiveEvidence(events, { warm: () => '', data: { cold: {} } });
  for (const exposed of [JSON.stringify(published), JSON.stringify(evidence)]) {
    for (const secret of ['192.168.1.50', '8081', '/v1/chat', 'private-checkout', 'C:\\Dev']) {
      assert.ok(!exposed.includes(secret), `leaked ${secret}`);
    }
  }
  assert.equal(published.runs[0].decisions[0].summary, HARNESS_ERROR_SUMMARY);
  assert.equal(evidence.rounds[0].decision, HARNESS_ERROR_SUMMARY);
  assert.equal(published.runs[0].summary, 'Harness error was mentioned; bought tickspeed.', 'normal summaries are unchanged');
  assert.equal(evidence.rounds[1].decision, 'Harness error was mentioned; bought tickspeed.');
  assert.equal(events[1].summary, oldSummary, 'the event log itself is not rewritten');
});
