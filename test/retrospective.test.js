import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRetrospective } from '../src/agent.js';
import { initialControl } from '../src/controller.js';

test('retrospective keeps the assessment separate from an unrestricted short handoff', () => {
  const result = parseRetrospective(JSON.stringify({
    inheritedAssessment: 'harmful',
    reason: 'The inherited suggestion consumed five rounds without visible progress.',
    handoff: 'Try buying the next available dimension sooner. Check whether the gain changes before waiting.',
  }));
  assert.equal(result.inheritedAssessment, 'harmful');
  assert.match(result.handoff, /dimension/);
});

test('oversized or malformed handoffs fail closed', () => {
  const longHandoff = Array(151).fill('word').join(' ');
  assert.throws(() => parseRetrospective(JSON.stringify({ inheritedAssessment: 'none', reason: 'First run', handoff: longHandoff })), /150 words/);
  assert.throws(() => parseRetrospective('{"handoff":"hello"}'), /Invalid inherited assessment/);
});

test('initial state contains no previous playthrough context', () => {
  assert.deepEqual(initialControl('prepilot').runs, []);
});
