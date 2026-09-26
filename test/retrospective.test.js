import test from 'node:test';
import assert from 'node:assert/strict';
import { handoffLine, NO_HANDOFF_REASON, parseRetrospective, playRound, retrospect, retrospectivePrompt } from '../src/agent.js';
import { initialControl } from '../src/controller.js';

const inherited = 'Current state: 6.36 Qa/sec, 13/20 5th Dimensions. Buy tickspeed when affordable.';

test('retrospective keeps the assessment separate from an unrestricted short handoff', () => {
  const result = parseRetrospective(JSON.stringify({
    inheritedAssessment: 'harmful',
    reason: 'The inherited suggestion consumed five rounds without visible progress.',
    handoff: 'Try buying the next available dimension sooner. Check whether the gain changes before waiting.',
  }), { inheritedHandoff: inherited });
  assert.equal(result.inheritedAssessment, 'harmful');
  assert.match(result.handoff, /dimension/);
});

test('oversized or malformed handoffs fail closed', () => {
  const longHandoff = Array(151).fill('word').join(' ');
  assert.throws(() => parseRetrospective(JSON.stringify({ inheritedAssessment: 'none', reason: 'First run', handoff: longHandoff })), /150 words/);
  assert.throws(() => parseRetrospective(JSON.stringify({ inheritedAssessment: 'useful', reason: 'x', handoff: '' })), /150 words/);
  assert.throws(() => parseRetrospective('{"handoff":"hello"}', { inheritedHandoff: inherited }), /Invalid inherited assessment/);
});

// Pre-pilot run 1 (2026-09-26) inherited no handoff, yet stored inheritedAssessment "useful" with a
// reason about its own play.
test('without an inherited handoff the assessment is none with an honest reason, whatever the model said', () => {
  const handoff = 'Continue current trajectory. Current state: 6.36 Qa/sec, 13/20 5th Dimensions.';
  const run1 = parseRetrospective(JSON.stringify({ inheritedAssessment: 'useful',
    reason: 'The agent demonstrated efficient progression.', handoff }), { inheritedHandoff: '' });
  assert.deepEqual(run1, { inheritedAssessment: 'none', reason: NO_HANDOFF_REASON, handoff,
    assessmentNormalized: true, modelInheritedAssessment: 'useful', modelReason: 'The agent demonstrated efficient progression.' });

  for (const value of [{ handoff }, { inheritedAssessment: 'bogus', reason: '', handoff }, { inheritedAssessment: 42, reason: null, handoff }]) {
    const result = parseRetrospective(JSON.stringify(value), { inheritedHandoff: '   ' });
    assert.equal(result.inheritedAssessment, 'none', 'a mislabelled absent note never fails the retrospective');
    assert.equal(result.reason, NO_HANDOFF_REASON);
    assert.equal(result.handoff, handoff, 'the successor handoff stays the model\'s own text');
  }

  const faithful = parseRetrospective(JSON.stringify({ inheritedAssessment: 'none', reason: 'First playthrough.', handoff }));
  assert.deepEqual(faithful, { inheritedAssessment: 'none', reason: 'First playthrough.', handoff });
});

test('an absent note does not relax the successor handoff limit', () => {
  const longHandoff = Array(151).fill('word').join(' ');
  assert.throws(() => parseRetrospective(JSON.stringify({ inheritedAssessment: 'useful', reason: 'x', handoff: longHandoff })), /150 words/);
});

test('round and retrospective prompts say each playthrough starts from a fresh save', () => {
  assert.equal(handoffLine(''), 'Previous playthrough handoff: (none)');
  assert.match(handoffLine(inherited), /earlier game; this playthrough started from a fresh save, so any state it reports is historical, not current/);
  assert.ok(handoffLine(inherited).endsWith(inherited), 'the inherited handoff is passed on verbatim');

  const first = retrospectivePrompt({ inheritedHandoff: '', evidence: {} });
  assert.match(first, /inherited no handoff, so inheritedAssessment must be none/);
  assert.match(first, /successor playthrough will start a new game from a fresh browser save/);
  const later = retrospectivePrompt({ inheritedHandoff: inherited, evidence: {} });
  assert.match(later, /previous playthrough's game, which started from its own fresh save/);
  assert.doesNotMatch(later, /must be none/);
});

function scriptedSession(reply, record) {
  return async (tools, systemPrompt) => {
    record.system = systemPrompt;
    const byName = Object.fromEntries(tools.map(tool => [tool.name, tool]));
    return {
      model: { contextWindow: 120000, input: ['text'] },
      isStreaming: false,
      getContextUsage: () => ({ contextWindow: 120000, tokens: 1000 }),
      subscribe: () => () => {},
      steer: async () => {},
      abort: async () => {},
      getLastAssistantText: () => reply,
      dispose() {},
      prompt: async text => {
        record.prompt = text;
        if (byName.finish_round) await byName.finish_round.execute('call', { summary: 'done', nextWakeSeconds: 60 });
      },
    };
  };
}

test('the retrospective session is told about the reset and records none for a first playthrough', async () => {
  const record = {};
  const result = await retrospect({ inheritedHandoff: '', evidence: { rounds: [] },
    createSession: scriptedSession(JSON.stringify({ inheritedAssessment: 'useful', reason: 'Good play.', handoff: 'Try things.' }), record) });
  assert.equal(result.inheritedAssessment, 'none');
  assert.equal(result.modelInheritedAssessment, 'useful');
  assert.match(record.system, /successor playthrough starts a new game from a fresh browser save/);
  assert.match(record.system, /historical observations/);
  assert.match(record.system, /You choose its content freely/);
  assert.match(record.prompt, /inheritedAssessment must be none/);
});

test('the round system prompt and first prompt state the fresh-save reset without banning handoff content', async () => {
  const record = {};
  const transcript = [];
  const browser = { observe: async () => ({ title: 'AD', url: 'game', text: 'You have 10 antimatter.', controls: [] }) };
  const memory = { warm: () => '', index: () => [] };
  await playRound({ browser, memory, inheritedHandoff: inherited, round: 1, maxSeconds: 1200, onEvent: () => {},
    onTranscript: entry => transcript.push(entry), createSession: scriptedSession('', record) });
  const system = transcript.find(entry => entry.role === 'system').content[0].text;
  assert.match(system, /Each new playthrough starts a new game from a fresh browser save/);
  assert.match(system, /historical observations, not your current state/);
  assert.match(record.prompt, /started from a fresh save, so any state it reports is historical, not current/);
  assert.ok(record.prompt.includes(inherited));
});

test('initial state contains no previous playthrough context', () => {
  assert.deepEqual(initialControl('prepilot').runs, []);
});
