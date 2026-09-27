import test from 'node:test';
import assert from 'node:assert/strict';
import { playRound } from '../src/agent.js';
import { retrospectiveEvidence } from '../src/controller.js';

const LEAKS = ['C:\\','someone', 'secret-dir', '192.168.1.50', '8080', 'http://', 'ECONNREFUSED', '    at ', 'errors.test.js'];

function leakyError(message) {
  const error = new Error(message);
  error.stack = `Error: ${message}\n    at probe (C:\\Users\\someone\\secret-dir\\errors.test.js:1:1)`;
  return error;
}

// Calls one tool, keeps its model-facing result, then finishes the round with a summary quoting it.
function toolSession(name, params, record) {
  return async tools => {
    const byName = Object.fromEntries(tools.map(tool => [tool.name, tool]));
    return {
      model: { contextWindow: 120000, input: ['text'] },
      isStreaming: false,
      getContextUsage: () => ({ contextWindow: 120000, tokens: 1000 }),
      subscribe: () => () => {},
      steer: async () => {},
      abort: async () => {},
      getLastAssistantText: () => '',
      dispose() {},
      prompt: async () => {
        record.toolText = (await byName[name].execute('call', params)).content[0].text;
        await byName.finish_round.execute('call', { summary: `Tool said ${record.toolText}`, nextWakeSeconds: 60 });
      },
    };
  };
}

async function roundWith({ browser, memory, name, params }) {
  const record = {};
  const events = [];
  await playRound({ browser, memory, inheritedHandoff: '', round: 1, maxSeconds: 1200,
    onEvent: event => events.push({ round: 1, ...event }), createSession: toolSession(name, params, record) });
  return { record, events };
}

const observe = async () => ({ title: 'AD', url: 'game', text: 'You have 10 antimatter.', controls: [] });

test('a browser failure reaches the model only as a category; the private event keeps the detail', async () => {
  const browser = { observe, click: async () => { throw leakyError('page.click: connect ECONNREFUSED http://192.168.1.50:8080/v1 from C:\\Users\\someone\\secret-dir'); } };
  const memory = { warm: () => '', index: () => [] };
  const { record, events } = await roundWith({ browser, memory, name: 'browser', params: { action: 'click', index: 0 } });
  assert.deepEqual(JSON.parse(record.toolText), { error: 'Browser action failed', category: 'connection' });
  const privateEvent = events.find(event => event.type === 'browser_error');
  assert.match(privateEvent.message, /192\.168\.1\.50:8080/);
  assert.match(privateEvent.message, /secret-dir/);
  assert.match(privateEvent.stack, /C:\\Users\\someone/);
  const decision = events.find(event => event.type === 'round_decision');
  const evidence = retrospectiveEvidence(events, { warm: () => '', data: { cold: {} } });
  for (const leak of LEAKS) {
    assert.ok(!record.toolText.includes(leak), `tool result must not contain ${leak}`);
    assert.ok(!decision.summary.includes(leak), `summary must not contain ${leak}`);
    assert.ok(!JSON.stringify(evidence).includes(leak), `evidence must not contain ${leak}`);
  }
  assert.deepEqual(evidence.rounds[0].errors, [{ kind: 'browser_error', category: 'connection' }]);
});

test('a memory failure reaches the model only as a category; the private event keeps the detail', async () => {
  const memory = { warm: () => '', index: () => [],
    put: () => { throw leakyError("EACCES: permission denied, open 'C:\\Users\\someone\\secret-dir\\memory.json'"); } };
  const { record, events } = await roundWith({ browser: { observe }, memory, name: 'memory',
    params: { operation: 'write-cold', key: 'plan', title: 'Plan', text: 'Buy dimensions.' } });
  assert.deepEqual(JSON.parse(record.toolText), { error: 'Memory operation failed', category: 'other' });
  const privateEvent = events.find(event => event.type === 'memory_error');
  assert.equal(privateEvent.operation, 'write-cold');
  assert.match(privateEvent.message, /C:\\Users\\someone\\secret-dir\\memory\.json/);
  assert.match(privateEvent.stack, /errors\.test\.js/);
  const decision = events.find(event => event.type === 'round_decision');
  const evidence = retrospectiveEvidence(events, { warm: () => '', data: { cold: {} } });
  for (const leak of LEAKS) {
    assert.ok(!record.toolText.includes(leak), `tool result must not contain ${leak}`);
    assert.ok(!decision.summary.includes(leak), `summary must not contain ${leak}`);
    assert.ok(!JSON.stringify(evidence).includes(leak), `evidence must not contain ${leak}`);
  }
  assert.deepEqual(evidence.rounds[0].errors, [{ kind: 'memory_error', category: 'other' }]);
});

test('memory limit failures keep a specific category the model can act on', async () => {
  const memory = { warm: () => '', index: () => [], setWarm: () => { throw new Error('Warm memory exceeds 2200 characters'); } };
  const { record } = await roundWith({ browser: { observe }, memory, name: 'memory', params: { operation: 'write-warm', text: 'x' } });
  assert.deepEqual(JSON.parse(record.toolText), { error: 'Memory operation failed', category: 'warm_memory_too_long' });
});
