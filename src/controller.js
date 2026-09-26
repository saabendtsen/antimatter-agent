import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GameBrowser } from './browser.js';
import { GameMemory } from './memory.js';
import { playRound, retrospect } from './agent.js';
import { appendEvent, readEvents, readJson, safePublicText, writeJsonAtomic } from './storage.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODE = process.argv.includes('--pilot') ? 'pilot' : 'prepilot';
const STATE_DIR = path.join(ROOT, 'state', MODE);
const PUBLIC_DIR = path.join(ROOT, 'publication');
const CONTROL_FILE = path.join(STATE_DIR, 'control.json');
const LIMITS = MODE === 'pilot'
  ? { playthroughs: 1, rounds: Number(process.env.PILOT_ROUNDS || 300), seconds: 24 * 3600 }
  : { playthroughs: 3, rounds: 30, seconds: 3600 };

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function runDir(index) { return path.join(STATE_DIR, `run-${String(index + 1).padStart(2, '0')}`); }
function eventsFile(index) { return path.join(runDir(index), 'events.jsonl'); }
function log(index, event) { appendEvent(eventsFile(index), event); }

export function initialControl(mode = MODE) {
  return { mode, status: 'active', runs: [], createdAt: new Date().toISOString() };
}

function acquireLock() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const lock = path.join(STATE_DIR, 'controller.lock');
  try { fs.writeFileSync(lock, String(process.pid), { flag: 'wx' }); }
  catch {
    const oldPid = Number(fs.readFileSync(lock, 'utf8'));
    try { process.kill(oldPid, 0); throw new Error(`Controller already running as PID ${oldPid}`); }
    catch (error) {
      if (error.code !== 'ESRCH') throw error;
      fs.unlinkSync(lock);
      fs.writeFileSync(lock, String(process.pid), { flag: 'wx' });
    }
  }
  return () => { if (fs.existsSync(lock) && fs.readFileSync(lock, 'utf8') === String(process.pid)) fs.unlinkSync(lock); };
}

function publicHistory(control) {
  return control.runs.map((run, index) => ({
    number: index + 1,
    status: run.status,
    startedAt: run.startedAt,
    endedAt: run.endedAt ?? null,
    rounds: run.round,
    inheritedHandoff: safePublicText(run.inheritedHandoff, 1200),
    retrospective: run.retrospective ? {
      inheritedAssessment: run.retrospective.inheritedAssessment,
      reason: safePublicText(run.retrospective.reason, 1200),
      handoff: safePublicText(run.retrospective.handoff, 1200),
    } : null,
    decisions: readEvents(eventsFile(index))
      .filter(e => e.type === 'round_end')
      .map(e => ({ at: e.at, round: e.round, summary: safePublicText(e.summary, 1000), nextWakeSeconds: e.nextWakeSeconds, incomplete: Boolean(e.incomplete) })),
  }));
}

function publish(control, current = {}) {
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  const previous = readJson(path.join(PUBLIC_DIR, 'latest.json'), { current: {} }).current;
  const visible = Object.keys(current).length ? current : previous;
  writeJsonAtomic(path.join(PUBLIC_DIR, 'latest.json'), {
    mode: control.mode, status: control.status, updatedAt: new Date().toISOString(),
    current: { run: visible.run ?? control.runs.length, round: visible.round ?? null, summary: safePublicText(visible.summary, 1000),
      pageText: safePublicText(visible.pageText, 6000), screenshot: visible.screenshot ?? null,
      nextWakeAt: visible.nextWakeAt ?? null,
      antimatter: visible.antimatter ?? null, production: visible.production ?? null },
    runs: publicHistory(control),
  });
}

function runEvidence(index, memory) {
  return {
    events: readEvents(eventsFile(index)).filter(event => ['round_start', 'round_decision', 'round_end', 'browser_error', 'model_error', 'harness_error', 'game_checkpoint_error', 'memory_warm_write', 'memory_cold_write', 'memory_read', 'memory_delete'].includes(event.type)),
    finalWarmMemory: memory.warm(),
    finalColdNotes: memory.data.cold,
  };
}

async function executeRun(control, index) {
  const dir = runDir(index);
  fs.mkdirSync(dir, { recursive: true });
  let run = control.runs[index];
  if (!run) {
    run = { status: 'active', startedAt: new Date().toISOString(), round: 0,
      inheritedHandoff: index ? control.runs[index - 1].retrospective.handoff : '', nextWakeAt: null };
    control.runs.push(run);
    writeJsonAtomic(CONTROL_FILE, control);
    log(index, { type: 'run_start', inheritedHandoff: run.inheritedHandoff });
  }
  const memory = new GameMemory(path.join(dir, 'memory.json'), event => log(index, event));
  const browser = new GameBrowser(path.join(dir, 'browser-profile'));
  if (run.status === 'active') await browser.open();
  try {
    while (run.status === 'active') {
      const deadline = Date.parse(run.startedAt) + LIMITS.seconds * 1000;
      if (Date.now() >= deadline || run.round >= LIMITS.rounds) break;
      if (run.nextWakeAt && Date.now() < Date.parse(run.nextWakeAt)) {
        await sleep(Math.min(30000, Date.parse(run.nextWakeAt) - Date.now()));
        continue;
      }
      run.round += 1;
      const number = run.round;
      log(index, { type: 'round_start', round: number });
      writeJsonAtomic(CONTROL_FILE, control);
      let outcome;
      try {
        outcome = await playRound({ browser, memory, inheritedHandoff: run.inheritedHandoff,
          round: number, maxSeconds: Math.max(15, Math.min(180, Math.ceil((deadline - Date.now()) / 1000))),
          onEvent: event => log(index, { round: number, ...event }) });
      } catch (error) {
        outcome = { summary: `Harness error: ${error.message}`, nextWakeSeconds: 60, incomplete: true };
        log(index, { type: 'harness_error', round: number, message: error.stack ?? error.message });
      }
      run.nextWakeAt = new Date(Date.now() + outcome.nextWakeSeconds * 1000).toISOString();
      run.consecutiveFailures = outcome.incomplete ? (run.consecutiveFailures ?? 0) + 1 : 0;
      log(index, { type: 'round_end', round: number, ...outcome });
      try { await browser.checkpoint(); log(index, { type: 'game_checkpoint', round: number }); }
      catch (error) { log(index, { type: 'game_checkpoint_error', round: number, message: error.message }); }
      let pageText = '';
      let screenshot = null;
      try {
        pageText = (await browser.observe()).text;
        fs.mkdirSync(PUBLIC_DIR, { recursive: true });
        await browser.screenshot(path.join(PUBLIC_DIR, 'screen.png'));
        screenshot = `screen.png?v=${Date.now()}`;
      } catch (error) { log(index, { type: 'browser_error', round: number, message: error.message }); }
      writeJsonAtomic(CONTROL_FILE, control);
      publish(control, { run: index + 1, round: number, summary: outcome.summary, pageText, screenshot, nextWakeAt: run.nextWakeAt,
        antimatter: pageText.match(/You have ([^\n]+?) antimatter\./)?.[1] ?? null,
        production: pageText.match(/You are getting ([^\n]+?) antimatter per second\./)?.[1] ?? null });
      if (run.consecutiveFailures >= 3) {
        run.status = 'blocked';
        log(index, { type: 'run_blocked', reason: 'Three consecutive incomplete rounds' });
        writeJsonAtomic(CONTROL_FILE, control);
        publish(control);
        break;
      }
      if (MODE === 'pilot' && outcome.infinityReached) {
        run.infinityClaimed = true;
        break;
      }
    }
  } finally { await browser.close(); }

  if (run.status === 'active') {
    run.status = 'retrospective';
    run.endedAt = new Date().toISOString();
    log(index, { type: 'run_end', rounds: run.round, durationSeconds: Math.round((Date.now() - Date.parse(run.startedAt)) / 1000), infinityClaimed: Boolean(run.infinityClaimed) });
    writeJsonAtomic(CONTROL_FILE, control);
  }
  if (run.status === 'retrospective') {
    try {
      run.retrospective = await retrospect({ inheritedHandoff: run.inheritedHandoff, evidence: runEvidence(index, memory) });
      run.status = 'complete';
      log(index, { type: 'retrospective', ...run.retrospective });
    } catch (error) {
      run.status = 'retrospective_failed';
      log(index, { type: 'retrospective_error', message: error.stack ?? error.message });
    }
    writeJsonAtomic(CONTROL_FILE, control);
    publish(control);
  }
}

async function main() {
  const release = acquireLock();
  try {
    const control = readJson(CONTROL_FILE, initialControl());
    if (control.mode !== MODE) throw new Error('Mode mismatch in saved controller state');
    publish(control);
    for (let index = 0; index < LIMITS.playthroughs; index++) {
      if (control.runs[index]?.status === 'complete') continue;
      if (index && control.runs[index - 1]?.status !== 'complete') break;
      await executeRun(control, index);
      if (control.runs[index].status !== 'complete') break;
    }
    control.status = control.runs.length === LIMITS.playthroughs && control.runs.every(run => run.status === 'complete') ? 'complete' : 'needs_attention';
    writeJsonAtomic(CONTROL_FILE, control);
    publish(control);
  } finally { release(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
