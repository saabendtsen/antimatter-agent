import test from 'node:test';
import assert from 'node:assert/strict';
import { gameMetrics, publicCurrent } from '../src/controller.js';

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

