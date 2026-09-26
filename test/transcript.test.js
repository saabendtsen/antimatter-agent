import assert from 'node:assert/strict';
import test from 'node:test';
import { transcriptMessage } from '../src/transcript.js';

test('keeps completed model text, thinking, tool calls, and usage without provider metadata', () => {
  const entry = transcriptMessage({ role: 'assistant', content: [
    { type: 'thinking', thinking: 'Wait for a cheaper upgrade', signature: 'provider-secret' },
    { type: 'text', text: 'I will inspect the page.' },
    { type: 'toolCall', id: 'call-1', name: 'browser', arguments: { action: 'inspect' } },
  ], usage: { input: 12, output: 8 }, stopReason: 'toolUse', apiKey: 'never-log' });
  assert.deepEqual(entry, { role: 'assistant', content: [
    { type: 'thinking', thinking: 'Wait for a cheaper upgrade' },
    { type: 'text', text: 'I will inspect the page.' },
    { type: 'toolCall', id: 'call-1', name: 'browser', arguments: { action: 'inspect' } },
  ], usage: { input: 12, output: 8 }, stopReason: 'toolUse' });
});

test('records tool observations but omits image payloads', () => {
  const entry = transcriptMessage({ role: 'toolResult', toolName: 'browser', toolCallId: 'call-1', content: [
    { type: 'text', text: 'Visible game page' },
    { type: 'image', mimeType: 'image/png', data: 'base64-private-image' },
  ] });
  assert.deepEqual(entry, { role: 'toolResult', toolName: 'browser', toolCallId: 'call-1', content: [
    { type: 'text', text: 'Visible game page' },
    { type: 'image', mimeType: 'image/png', dataOmitted: true },
  ] });
});
