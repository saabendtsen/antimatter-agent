import test from 'node:test';
import assert from 'node:assert/strict';
import { contextCeiling, contextReport } from '../src/context.js';

test('action ceiling leaves room for notes and finishing the round', () => {
  assert.deepEqual(contextCeiling({ contextWindow: 120000, tokens: 83999 }), {
    closed: false, contextWindow: 120000, tokens: 83999, ceilingTokens: 84000,
  });
  assert.equal(contextCeiling({ contextWindow: 120000, tokens: 84000 }).closed, true);
  assert.equal(contextCeiling({ contextWindow: 120000, tokens: null }).closed, true);
});

test('round report describes peak window occupancy rather than summed request usage', () => {
  assert.deepEqual(contextReport(120000, 30000, false), {
    contextWindow: 120000, peakTokens: 30000, peakPercent: 25,
    ceilingTokens: 84000, ceilingReached: false,
  });
});
