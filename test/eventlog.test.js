import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendEvent, readEvents, recoverEventLog } from '../src/storage.js';

function logWith(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'antimatter-events-'));
  const file = path.join(dir, 'events.jsonl');
  fs.writeFileSync(file, content);
  return { dir, file };
}

const valid = '{"at":"2026-09-27T10:00:00.000Z","type":"round_start","round":4}\n'
  + '{"at":"2026-09-27T10:15:00.000Z","type":"round_end","round":4,"summary":"Bought tickspeed."}\n';

test('a valid event log is left untouched', () => {
  const { dir, file } = logWith(valid);
  assert.equal(recoverEventLog(file), null);
  assert.equal(fs.readFileSync(file, 'utf8'), valid);
  assert.deepEqual(fs.readdirSync(dir), ['events.jsonl']);
  assert.equal(recoverEventLog(path.join(dir, 'missing.jsonl')), null);
});

test('a torn final line from a crash mid-append is preserved aside and cut, and later appends read cleanly', () => {
  const torn = '{"at":"2026-09-27T10:16:00.000Z","type":"game_checkp';
  const { dir, file } = logWith(valid + torn);
  assert.throws(() => readEvents(file), SyntaxError);
  const recovered = recoverEventLog(file, 1234);
  assert.deepEqual(recovered, { tornBytes: Buffer.byteLength(torn), preservedAs: 'events.jsonl.torn-1234' });
  assert.equal(fs.readFileSync(path.join(dir, recovered.preservedAs), 'utf8'), torn);
  assert.equal(fs.readFileSync(file, 'utf8'), valid);
  appendEvent(file, { type: 'event_log_recovered', ...recovered });
  appendEvent(file, { type: 'controller_resume' });
  assert.deepEqual(readEvents(file).map(e => e.type), ['round_start', 'round_end', 'event_log_recovered', 'controller_resume']);
  assert.equal(recoverEventLog(file), null);
});

test('a complete final record that only lost its newline is kept', () => {
  const last = '{"at":"2026-09-27T10:16:00.000Z","type":"game_checkpoint","round":4}';
  const { file } = logWith(valid + last);
  assert.deepEqual(recoverEventLog(file), { tornBytes: 0, completedLine: true });
  appendEvent(file, { type: 'controller_resume' });
  assert.deepEqual(readEvents(file).map(e => e.type), ['round_start', 'round_end', 'game_checkpoint', 'controller_resume']);
});

test('a malformed middle record fails instead of discarding history', () => {
  const content = '{"at":"2026-09-27T10:00:00.000Z","type":"round_start","round":4}\n'
    + '{"at":"2026-09-27T10:05:00.000Z","type":"brow\n'
    + '{"at":"2026-09-27T10:15:00.000Z","type":"round_end","round":4}\n'
    + '{"at":"2026-09-27T10:16:00.000Z","type":"game_ch';
  const { dir, file } = logWith(content);
  assert.throws(() => recoverEventLog(file), /Malformed event record at line 2/);
  assert.equal(fs.readFileSync(file, 'utf8'), content);
  assert.deepEqual(fs.readdirSync(dir), ['events.jsonl']);
});
