import fs from 'node:fs';
import path from 'node:path';
import { GameBrowser } from '../src/browser.js';
import { GameMemory } from '../src/memory.js';

const dir = path.resolve('state', 'smoke');
fs.mkdirSync(dir, { recursive: true });
const browser = new GameBrowser(path.join(dir, 'browser-profile'));
const memory = new GameMemory(path.join(dir, 'memory.json'), event => console.log(JSON.stringify(event)));
try {
  await browser.open();
  const { playRound } = await import('../src/agent.js');
  const outcome = await playRound({ browser, memory, inheritedHandoff: '', round: 1, maxSeconds: 180,
    onEvent: event => console.log(JSON.stringify(event)) });
  console.log('OUTCOME', JSON.stringify(outcome));
  await browser.screenshot(path.join(dir, 'after.png'));
} finally { await browser.close(); }
