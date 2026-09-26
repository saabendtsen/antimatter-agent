import test from 'node:test';
import assert from 'node:assert/strict';
import { MIN_ACTION_SECONDS, MIN_ROUND_SECONDS, playRound, ROUND_LIMITS, roundTiming } from '../src/agent.js';
import { roundSeconds } from '../src/controller.js';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const parse = value => JSON.parse(value.content[0].text);

const browser = {
  observe: async () => ({ title: 'Antimatter Dimensions', url: 'game', text: 'You have 10 antimatter.', controls: [] }),
  click: async () => ({ title: 'Antimatter Dimensions', url: 'game', text: 'You have 0 antimatter.', controls: [] }),
};

function fakeMemory() {
  let warm = '';
  return { warm: () => warm, index: () => [], read: () => null, setWarm: text => { warm = text; }, put() {}, delete() {} };
}

// Stands in for the Pi session: each prompt runs a scripted model turn against the real round tools,
// and abort interrupts the turn the way the harness timer does.
function fakeSession(script) {
  const record = { prompts: [], steers: [], aborted: false };
  const factory = async tools => {
    const byName = Object.fromEntries(tools.map(tool => [tool.name, tool]));
    let streaming = false;
    let abortTurn = () => {};
    const session = {
      model: { contextWindow: 120000, input: ['text'] },
      get isStreaming() { return streaming; },
      getContextUsage: () => ({ contextWindow: 120000, tokens: 5000 }),
      subscribe: () => () => {},
      steer: async text => { record.steers.push(text); },
      abort: async () => { record.aborted = true; abortTurn(); },
      getLastAssistantText: () => 'still clicking',
      dispose() {},
      prompt: async text => {
        record.prompts.push(text);
        streaming = true;
        const call = async (name, params) => parse(await byName[name].execute('call', params));
        try {
          await Promise.race([script({ call, turn: record.prompts.length, aborted: () => record.aborted }), new Promise(resolve => { abortTurn = resolve; })]);
        } finally { streaming = false; }
      },
    };
    return session;
  };
  return { factory, record };
}

function round(script, timing) {
  const events = [];
  const { factory, record } = fakeSession(script);
  const outcome = playRound({ browser, memory: fakeMemory(), inheritedHandoff: '', round: 1, timing,
    onEvent: event => events.push(event), createSession: factory });
  return { outcome, events, record };
}

test('full rounds last twenty minutes: fifteen action minutes and a protected five-minute finish period', () => {
  assert.equal(ROUND_LIMITS.seconds, 20 * 60);
  assert.equal(ROUND_LIMITS.browserActions, 120);
  assert.equal(ROUND_LIMITS.toolCalls, 300);
  assert.deepEqual(roundTiming(ROUND_LIMITS.seconds), { maxSeconds: 1200, actionSeconds: 900, finishSeconds: 300 });
});

test('a shorter remaining playthrough shortens the action time, not the finish period', () => {
  assert.equal(roundSeconds(3600), 1200);
  assert.equal(roundSeconds(1190), 1190, 'a third round in a one-hour playthrough absorbs the harness overhead');
  assert.deepEqual(roundTiming(roundSeconds(1190)), { maxSeconds: 1190, actionSeconds: 890, finishSeconds: 300 });
  assert.deepEqual(roundTiming(roundSeconds(600)), { maxSeconds: 600, actionSeconds: 300, finishSeconds: 300 });
  assert.equal(MIN_ROUND_SECONDS, 300 + MIN_ACTION_SECONDS);
  assert.equal(roundSeconds(MIN_ROUND_SECONDS), MIN_ROUND_SECONDS);
  assert.equal(roundTiming(MIN_ROUND_SECONDS).actionSeconds, MIN_ACTION_SECONDS);
  assert.equal(roundTiming(MIN_ROUND_SECONDS).finishSeconds, 300);
  assert.equal(roundSeconds(MIN_ROUND_SECONDS - 1), null);
  assert.equal(roundSeconds(0), null);
});

// Pre-pilot run 3 round 1, scaled down 1000 times: a click in flight at the cutoff took about 17
// seconds and was blocked, the next model request then produced nothing for 117 seconds, and a note
// write took about 43 seconds before finish_round (about 16 seconds) could follow.
function slowFinishAfterCutoff() {
  return async ({ call }) => {
    let result;
    do { await wait(17); result = await call('browser', { action: 'click', index: 0 }); } while (!result.error);
    await wait(117);
    await wait(43);
    await call('memory', { operation: 'write-warm', text: 'Saved after the cutoff.' });
    await wait(16);
    await call('finish_round', { summary: 'Finished in the reserve.', nextWakeSeconds: 60 });
  };
}
const scaled = timing => Object.fromEntries(Object.entries(timing).map(([key, value]) => [key, value / 1000]));

test('the finish period covers the slow post-cutoff requests seen in pre-pilot run 3', async () => {
  const { outcome, events } = round(slowFinishAfterCutoff(), scaled(roundTiming(ROUND_LIMITS.seconds)));
  const result = await outcome;
  assert.equal(result.incomplete, undefined);
  assert.equal(result.summary, 'Finished in the reserve.');
  assert.equal(events.some(e => e.type === 'round_timeout'), false);
});

test('the former two-minute finish period loses the same round as incomplete', async () => {
  const { outcome } = round(slowFinishAfterCutoff(), scaled({ maxSeconds: 1080, actionSeconds: 960, finishSeconds: 120 }));
  const result = await outcome;
  assert.equal(result.incomplete, true);
  assert.equal(result.incompleteReason, 'round_time_limit');
});

test('after the cutoff, actions and retrieval close but notes and finish_round still work', async () => {
  const seen = {};
  const { outcome, events, record } = round(async ({ call }) => {
    seen.before = await call('browser', { action: 'click', index: 0 });
    await wait(150);
    seen.click = await call('browser', { action: 'click', index: 0 });
    seen.read = await call('memory', { operation: 'read', key: 'x' });
    seen.write = await call('memory', { operation: 'write-warm', text: 'Buy dimensions first.' });
    await call('finish_round', { summary: 'Saved notes.', nextWakeSeconds: 60 });
  }, { maxSeconds: 0.5, actionSeconds: 0.1, finishSeconds: 0.4 });
  const result = await outcome;
  assert.equal(seen.before.text, 'You have 0 antimatter.');
  assert.equal(typeof seen.before.secondsLeftForActions, 'number');
  assert.match(seen.click.error, /Action time is over.*call finish_round/);
  assert.match(seen.read.error, /Action time is over/);
  assert.equal(seen.write.ok, true);
  assert.equal(result.incomplete, undefined);
  assert.equal(result.summary, 'Saved notes.');
  assert.equal(events.filter(e => e.type === 'finish_window').length, 1);
  assert.equal(events.some(e => e.type === 'round_timeout'), false);
  assert.equal(record.steers.length, 1);
  assert.match(record.prompts[0], /final \d+ seconds are reserved for writing notes and calling finish_round/);
});

test('a round that still misses finish_round at the hard limit is recorded as a timeout, not complete', async () => {
  const { outcome, events, record } = round(async ({ call, aborted }) => {
    while (!aborted()) { await call('browser', { action: 'click', index: 0 }); await wait(20); }
  }, { maxSeconds: 0.3, actionSeconds: 0.1, finishSeconds: 0.2 });
  const result = await outcome;
  assert.equal(result.incomplete, true);
  assert.equal(result.incompleteReason, 'round_time_limit');
  assert.equal(result.finishWindowOpened, true);
  assert.equal(record.aborted, true);
  assert.deepEqual(events.filter(e => ['finish_window', 'round_timeout'].includes(e.type)).map(e => e.type),
    ['finish_window', 'round_timeout']);
  assert.equal(record.prompts.length, 1, 'a timed-out round is not re-prompted');
});

test('a model that stops without finish_round gets one reminder before the round is lost', async () => {
  const { outcome, events, record } = round(async ({ call, turn }) => {
    if (turn === 2) await call('finish_round', { summary: 'Finished after reminder.', nextWakeSeconds: 30 });
  }, { maxSeconds: 5, actionSeconds: 4, finishSeconds: 1 });
  const result = await outcome;
  assert.equal(result.summary, 'Finished after reminder.');
  assert.equal(record.prompts.length, 2);
  assert.match(record.prompts[1], /without calling finish_round/);
  assert.equal(events.filter(e => e.type === 'finish_reminder').length, 1);
});

test('a model that ignores the reminder ends honestly as incomplete', async () => {
  const { outcome, record } = round(async () => {}, { maxSeconds: 5, actionSeconds: 4, finishSeconds: 1 });
  const result = await outcome;
  assert.equal(result.incomplete, true);
  assert.equal(result.incompleteReason, 'no_finish_round');
  assert.equal(result.finishWindowOpened, false);
  assert.equal(record.prompts.length, 2);
});
