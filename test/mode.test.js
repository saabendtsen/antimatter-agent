import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { modeConfig } from '../src/controller.js';

const node = ['node', 'src/controller.js'];

test('default mode stays the three one-hour pre-pilot playthroughs without applied waits', () => {
  assert.deepEqual(modeConfig(node, {}), { mode: 'prepilot', limits: { playthroughs: 3, rounds: 30, seconds: 3600 },
    appliesWake: false, endsOnInfinityClaim: false });
});

test('--pilot stays the single 24-hour pilot with its round override', () => {
  assert.deepEqual(modeConfig([...node, '--pilot'], {}).limits, { playthroughs: 1, rounds: 300, seconds: 24 * 3600 });
  assert.equal(modeConfig([...node, '--pilot'], { PILOT_ROUNDS: '12' }).limits.rounds, 12);
  assert.equal(modeConfig([...node, '--pilot'], {}).appliesWake, true);
});

test('--soak is one four-hour playthrough that applies the requested wait in its own state', () => {
  const soak = modeConfig([...node, '--soak'], { PILOT_ROUNDS: '12' });
  assert.equal(soak.mode, 'soak');
  assert.deepEqual(soak.limits, { playthroughs: 1, rounds: 480, seconds: 4 * 3600 });
  assert.equal(soak.appliesWake, true);
  assert.equal(soak.endsOnInfinityClaim, true);
});

test('conflicting mode flags fail instead of silently choosing one', () => {
  assert.throws(() => modeConfig([...node, '--soak', '--pilot'], {}), /at most one/);
});

test('README documents how to start the soak and where its state lives', () => {
  const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(readme, /node src\/controller\.js --soak/);
  assert.match(readme, /state\/soak\//);
});
