import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GameMemory, WARM_LIMIT } from '../src/memory.js';

test('warm and cold notes persist independently and respect the context budget', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'antimatter-memory-'));
  try {
    const file = path.join(dir, 'memory.json');
    const events = [];
    const memory = new GameMemory(file, event => events.push(event));
    memory.setWarm('Buy the first dimension to begin production.');
    memory.put('early-growth', 'Early growth', 'Production continues between rounds.');
    assert.throws(() => memory.setWarm('x'.repeat(WARM_LIMIT + 1)), /exceeds/);
    const resumed = new GameMemory(file);
    assert.equal(resumed.warm(), 'Buy the first dimension to begin production.');
    assert.deepEqual(resumed.index(), [{ key: 'early-growth', title: 'Early growth' }]);
    assert.equal(resumed.read('early-growth').text, 'Production continues between rounds.');
    assert.equal(events.filter(e => e.type === 'memory_cold_write').length, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a new playthrough starts with empty memory when given a new directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'antimatter-memory-'));
  try {
    new GameMemory(path.join(dir, 'run-1', 'memory.json')).setWarm('Old lesson');
    const next = new GameMemory(path.join(dir, 'run-2', 'memory.json'));
    assert.equal(next.warm(), '');
    assert.deepEqual(next.index(), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
