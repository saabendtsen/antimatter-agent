import test from 'node:test';
import assert from 'node:assert/strict';
import { retrospectivePrompt } from '../src/agent.js';
import { EVIDENCE_LIMITS, retrospectiveEvidence } from '../src/controller.js';

const memory = { warm: () => 'Buy dimensions in order.', data: { cold: {} } };

// Shaped like pre-pilot run 1's dimensions tab (2026-09-26): the boost count sits about 600 characters
// into the visible text, past the 350 characters kept for the opening page and the last action.
function dimensionsPage(boosts, antimatter = '10.0') {
  return [`You have ${antimatter} antimatter.`, 'You are getting 0 antimatter per second.', '', '',
    'ADs produce ×1.125 faster per Tickspeed upgrade', 'Total Tickspeed: 1.000 / sec', '', 'Until 10', 'Max All (M)',
    'Buy 10 Dimension purchase multiplier: ×2.00',
    ...['1st', '2nd', '3rd', '4th', '5th'].flatMap(n => [`${n} Antimatter Dimension`, '×1.19', '0', 'Locked', 'Cost: 10 K AM']),
    `Dimension Boost (${boosts})`, 'Requires: 20 6th Antimatter D',
    'Antimatter Galaxies (0)', 'Requires: 80 8th Antimatter D', 'Time since last save: 12.61 seconds'].join('\n');
}

test('the retrospective sees the page a round ended on, including a boost bought in its last action', () => {
  const events = [
    { type: 'round_start', round: 18 },
    { type: 'round_observation', round: 18, text: dimensionsPage(1, '1.00 B'), controls: 40 },
    { type: 'browser', round: 18, action: 'inspect', observation: { text: dimensionsPage(1, '2.00 B') } },
    { type: 'browser', round: 18, action: 'scroll', index: null, observation: { text: dimensionsPage(1, '2.10 B') } },
    { type: 'browser', round: 18, action: 'click', index: 12, observation: { text: dimensionsPage(2) } },
    { type: 'round_decision', round: 18, summary: 'Bought the second Dimension Boost.' },
    { type: 'round_end', round: 18, summary: 'Bought the second Dimension Boost.', nextWakeSeconds: 60, appliedWakeSeconds: 0 },
    { type: 'game_checkpoint', round: 18 },
    { type: 'round_final_observation', round: 18, text: dimensionsPage(2, '12.0'), controls: 40 },
  ];
  const evidence = retrospectiveEvidence(events, memory);
  const [round] = evidence.rounds;
  assert.doesNotMatch(round.start, /Dimension Boost/, 'the opening page excerpt alone misses the boost count');
  assert.doesNotMatch(round.action.result, /Dimension Boost/, 'so does the last action excerpt');
  assert.equal(round.finalState.source, 'round_end');
  assert.match(round.finalState.text, /Dimension Boost \(2\)/);
  assert.match(round.finalState.text, /You have 12\.0 antimatter\./);
  assert.doesNotMatch(round.finalState.text, /\n/, 'the final page is collapsed to one concise line');
  assert.equal(round.browserActions, 2, 'inspect is not an action; scroll and click are');
  assert.equal(round.status, 'complete');
  assert.equal(round.finalStateError, undefined);
  assert.match(retrospectivePrompt({ inheritedHandoff: '', evidence }), /Dimension Boost \(2\)/);
  assert.match(retrospectivePrompt({ inheritedHandoff: '', evidence }), /finalState is the visible page when the round ended/);
});

test('an incomplete round keeps its latest visible page and states why the round-end capture is missing', () => {
  const events = [
    { type: 'round_start', round: 1 },
    { type: 'round_observation', round: 1, text: dimensionsPage(0), controls: 40 },
    { type: 'browser', round: 1, action: 'click', index: 3, observation: { text: dimensionsPage(0, '5.00') } },
    { type: 'browser', round: 1, action: 'inspect', observation: { text: dimensionsPage(1, '7.00') } },
    { type: 'round_timeout', round: 1 },
    { type: 'round_end', round: 1, summary: 'No finish_round call', incomplete: true, incompleteReason: 'round_time_limit' },
    { type: 'game_checkpoint_error', round: 1, message: 'Target page, context or browser has been closed' },
    { type: 'round_final_observation_error', round: 1, message: 'Target page, context or browser has been closed' },
    // A controller that stops mid-round leaves no round_end; its opening page is still the latest view.
    { type: 'round_start', round: 2 },
    { type: 'round_observation', round: 2, text: dimensionsPage(1, '8.00'), controls: 40 },
    { type: 'round_start', round: 3 },
  ];
  const [first, second, third] = retrospectiveEvidence(events, memory).rounds;
  assert.equal(first.status, 'incomplete');
  assert.equal(first.incompleteReason, 'round_time_limit');
  assert.equal(first.browserActions, 1);
  assert.deepEqual(first.finalState, { source: 'last_browser_result', text: first.finalState.text });
  assert.match(first.finalState.text, /You have 7\.00 antimatter\..*Dimension Boost \(1\)/);
  assert.match(first.finalStateError, /browser has been closed/);
  assert.deepEqual(first.errors, ['Target page, context or browser has been closed']);
  assert.equal(second.status, 'no_round_end');
  assert.equal(second.finalState.source, 'round_start');
  assert.match(second.finalState.text, /You have 8\.00 antimatter\./);
  assert.equal(third.finalState, null, 'nothing visible was recorded, so nothing is invented');
  assert.equal(third.browserActions, 0);
});

test('retrospective evidence keeps at most 30 recent rounds with concise pages, even for a 480-round soak', () => {
  const long = `You have 1 antimatter. ${'Dimension row text. '.repeat(700)}`.slice(0, 14000);
  const events = [];
  for (let round = 1; round <= 480; round++) {
    events.push({ type: 'round_observation', round, text: long.slice(0, 1800) });
    for (let i = 0; i < 120; i++) events.push({ type: 'browser', round, action: 'click', index: i, observation: { text: long.slice(0, 1800) } });
    for (let i = 0; i < 20; i++) events.push({ type: 'browser_error', round, message: 'x'.repeat(2000) });
    events.push({ type: 'round_end', round, summary: 's'.repeat(1000), nextWakeSeconds: 600, appliedWakeSeconds: 600,
      contextUsage: { contextWindow: 120000, peakTokens: 84000, peakPercent: 70, ceilingTokens: 84000, ceilingReached: true } });
    events.push({ type: 'round_final_observation', round, text: long.slice(0, 1800) });
  }
  const evidence = retrospectiveEvidence(events, memory);
  assert.equal(evidence.rounds.length, EVIDENCE_LIMITS.rounds);
  assert.equal(evidence.totalRounds, 480);
  assert.equal(evidence.omittedEarlierRounds, 450);
  assert.deepEqual(evidence.rounds.map(round => round.number), Array.from({ length: 30 }, (_, i) => 451 + i));
  for (const round of evidence.rounds) {
    assert.ok(round.finalState.text.length <= EVIDENCE_LIMITS.finalStateCharacters);
    assert.ok(round.errors.length <= EVIDENCE_LIMITS.errorsPerRound);
    assert.equal(round.browserActions, 120);
  }
  // About 4 characters per token: the worst-case prompt stays near a third of the 120k-token window,
  // leaving room for the system prompt, bounded notes and the reply.
  assert.ok(retrospectivePrompt({ inheritedHandoff: 'x', evidence }).length < 160000);
});
