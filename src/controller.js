import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GameBrowser } from './browser.js';
import { GameMemory } from './memory.js';
import { MIN_ROUND_SECONDS, playRound, retrospect, ROUND_LIMITS } from './agent.js';
import { resumeRecord, sourceProvenance } from './provenance.js';
import { appendEvent, readEvents, readJson, safePublicText, writeJsonAtomic } from './storage.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The soak checks whether one playthrough stays coherent across four hours of applied waits before
// the 24-hour pilot. Its round cap is a runaway guard; the four-hour limit is meant to end it.
export function modeConfig(argv = process.argv, env = process.env) {
  const flags = ['--pilot', '--soak'].filter(flag => argv.includes(flag));
  if (flags.length > 1) throw new Error('Choose at most one of --pilot and --soak');
  if (flags[0] === '--pilot') {
    return { mode: 'pilot', limits: { playthroughs: 1, rounds: Number(env.PILOT_ROUNDS || 300), seconds: 24 * 3600 },
      appliesWake: true, endsOnInfinityClaim: true };
  }
  if (flags[0] === '--soak') {
    return { mode: 'soak', limits: { playthroughs: 1, rounds: 480, seconds: 4 * 3600 },
      appliesWake: true, endsOnInfinityClaim: true };
  }
  return { mode: 'prepilot', limits: { playthroughs: 3, rounds: 30, seconds: 3600 },
    appliesWake: false, endsOnInfinityClaim: false };
}

const CONFIG = modeConfig();
const MODE = CONFIG.mode;
const STATE_DIR = path.join(ROOT, 'state', MODE);
const PUBLIC_DIR = path.join(ROOT, 'publication');
const CONTROL_FILE = path.join(STATE_DIR, 'control.json');
const LIMITS = CONFIG.limits;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function runDir(index) { return path.join(STATE_DIR, `run-${String(index + 1).padStart(2, '0')}`); }
function eventsFile(index) { return path.join(runDir(index), 'events.jsonl'); }
function log(index, event) { appendEvent(eventsFile(index), event); }
function transcript(index, event) { appendEvent(path.join(runDir(index), 'transcript.jsonl'), event); }

// A round never outlasts the playthrough. Near the playthrough deadline, the round loses action time,
// never finish time; a round too short to keep MIN_ACTION_SECONDS of actions plus the full finish
// period is not started, and the playthrough ends instead.
export function roundSeconds(remainingSeconds) {
  return remainingSeconds < MIN_ROUND_SECONDS ? null : Math.min(ROUND_LIMITS.seconds, remainingSeconds);
}

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
    durationSeconds: run.endedAt ? Math.round((Date.parse(run.endedAt) - Date.parse(run.startedAt)) / 1000) : null,
    infinityClaimed: Boolean(run.infinityClaimed),
    summary: safePublicText(readEvents(eventsFile(index)).filter(e => e.type === 'round_end').at(-1)?.summary, 1000),
    inheritedHandoff: safePublicText(run.inheritedHandoff, 1200),
    retrospective: run.retrospective ? {
      inheritedAssessment: run.retrospective.inheritedAssessment,
      reason: safePublicText(run.retrospective.reason, 1200),
      handoff: safePublicText(run.retrospective.handoff, 1200),
    } : null,
    decisions: readEvents(eventsFile(index))
      .filter(e => e.type === 'round_end')
      .map(e => ({ at: e.at, round: e.round, summary: safePublicText(e.summary, 1000),
        requestedWakeSeconds: e.nextWakeSeconds, appliedWakeSeconds: e.appliedWakeSeconds,
        contextUsage: e.contextUsage ?? null, incomplete: Boolean(e.incomplete) })),
  }));
}

// The public "current" block always describes the newest playthrough. An update is merged over the
// previous public state only when both belong to the same run, so a new playthrough never inherits
// the prior game's screenshot, page text, decision or wake time.
export function publicCurrent(control, update = {}, previous = {}) {
  const run = update.run ?? control.runs.length;
  const visible = { ...(previous?.run === run ? previous : { round: control.runs[run - 1]?.round || null }), ...update };
  return { run, round: visible.round ?? null, phase: visible.phase ?? null,
    roundStartedAt: visible.roundStartedAt ?? null, roundEndsBy: visible.roundEndsBy ?? null,
    summary: safePublicText(visible.summary, 1000), pageText: safePublicText(visible.pageText, 6000),
    screenshot: visible.screenshot ?? null, nextWakeAt: visible.nextWakeAt ?? null,
    antimatter: visible.antimatter ?? null, production: visible.production ?? null };
}

export function gameMetrics(pageText) {
  return { antimatter: pageText.match(/You have ([^\n]+?) antimatter\./)?.[1] ?? null,
    production: pageText.match(/You are getting ([^\n]+?) antimatter per second\./)?.[1] ?? null };
}

function publish(control, update = {}) {
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  const previous = readJson(path.join(PUBLIC_DIR, 'latest.json'), { current: {} }).current;
  writeJsonAtomic(path.join(PUBLIC_DIR, 'latest.json'), {
    mode: control.mode, status: control.status, updatedAt: new Date().toISOString(),
    current: publicCurrent(control, update, previous),
    runs: publicHistory(control),
  });
}

// The public screenshot and page text come from the harness's own observation, never from a player tool.
async function publicView(browser, index, round) {
  try {
    const pageText = (await browser.observe()).text;
    fs.mkdirSync(PUBLIC_DIR, { recursive: true });
    await browser.screenshot(path.join(PUBLIC_DIR, 'screen.png'));
    return { pageText, screenshot: `screen.png?v=${Date.now()}`, ...gameMetrics(pageText) };
  } catch (error) {
    log(index, { type: 'browser_error', round, message: error.message });
    return { pageText: '', screenshot: null, antimatter: null, production: null };
  }
}

function runEvidence(index, memory) {
  const events = readEvents(eventsFile(index));
  const rounds = new Map();
  for (const event of events) {
    if (!Number.isInteger(event.round)) continue;
    if (!rounds.has(event.round)) rounds.set(event.round, { number: event.round });
    const item = rounds.get(event.round);
    if (event.type === 'round_observation') item.start = safePublicText(event.text, 350);
    if (event.type === 'browser' && event.action !== 'inspect') {
      item.action = { kind: event.action, control: event.index,
        result: safePublicText(event.observation?.text, 350) };
    }
    if (event.type === 'round_end') {
      item.decision = safePublicText(event.summary, 500);
      item.requestedWaitSeconds = event.nextWakeSeconds;
      item.appliedWaitSeconds = event.appliedWakeSeconds;
      item.contextUsage = event.contextUsage;
      item.incomplete = Boolean(event.incomplete);
      if (event.incompleteReason) item.incompleteReason = event.incompleteReason;
    }
    if (['browser_error', 'model_error', 'harness_error', 'game_checkpoint_error'].includes(event.type)) {
      (item.errors ??= []).push(safePublicText(event.message, 250));
    }
  }
  return {
    rounds: [...rounds.values()],
    memoryChanges: events.filter(event => ['memory_warm_write', 'memory_cold_write', 'memory_delete'].includes(event.type))
      .map(event => ({ round: event.round, kind: event.type, key: event.key,
        text: safePublicText(event.text, 250) })).slice(-30),
    finalWarmMemory: memory.warm(),
    finalColdNotes: memory.data.cold,
  };
}

// Blocked runs wait for an operator and do no work, so only these statuses count as resumed.
const RESUMABLE = ['active', 'retrospective', 'retrospective_failed'];

async function executeRun(control, index, previousHarness) {
  const dir = runDir(index);
  fs.mkdirSync(dir, { recursive: true });
  let run = control.runs[index];
  if (!run) {
    run = { status: 'active', startedAt: new Date().toISOString(), round: 0,
      inheritedHandoff: index ? control.runs[index - 1].retrospective.handoff : '', nextWakeAt: null,
      harness: control.harness };
    control.runs.push(run);
    writeJsonAtomic(CONTROL_FILE, control);
    log(index, { type: 'run_start', inheritedHandoff: run.inheritedHandoff, harness: run.harness });
    publish(control, { run: index + 1, round: null, phase: 'starting' });
  } else if (RESUMABLE.includes(run.status)) {
    // An existing unfinished run here always means a new controller process picked it up.
    log(index, resumeRecord({ run, previousHarness, harness: control.harness,
      lastEvent: readEvents(eventsFile(index)).at(-1) }));
  }
  const memory = new GameMemory(path.join(dir, 'memory.json'), event => log(index, { round: run.round, ...event }));
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
      const maxSeconds = roundSeconds(Math.floor((deadline - Date.now()) / 1000));
      if (!maxSeconds) break;
      run.round += 1;
      const number = run.round;
      log(index, { type: 'round_start', round: number });
      writeJsonAtomic(CONTROL_FILE, control);
      // Announce the round before the model starts, so the public view never shows the prior round or
      // playthrough as current. The round's own timer starts inside playRound, after this capture.
      publish(control, { run: index + 1, round: number, phase: 'playing', nextWakeAt: null,
        roundStartedAt: new Date().toISOString(), roundEndsBy: new Date(Date.now() + maxSeconds * 1000).toISOString(),
        ...await publicView(browser, index, number) });
      let outcome;
      try {
        outcome = await playRound({ browser, memory, inheritedHandoff: run.inheritedHandoff,
          round: number, maxSeconds, immediateNextRound: !CONFIG.appliesWake,
          onEvent: event => log(index, { round: number, ...event }),
          onTranscript: entry => transcript(index, { phase: 'play', round: number, ...entry }) });
      } catch (error) {
        outcome = { summary: `Harness error: ${error.message}`, nextWakeSeconds: 60, incomplete: true };
        log(index, { type: 'harness_error', round: number, message: error.stack ?? error.message });
      }
      const appliedWakeSeconds = CONFIG.appliesWake ? outcome.nextWakeSeconds : 0;
      run.nextWakeAt = appliedWakeSeconds ? new Date(Date.now() + appliedWakeSeconds * 1000).toISOString() : null;
      run.consecutiveFailures = outcome.incomplete ? (run.consecutiveFailures ?? 0) + 1 : 0;
      log(index, { type: 'round_end', round: number, ...outcome, appliedWakeSeconds });
      try { await browser.checkpoint(); log(index, { type: 'game_checkpoint', round: number }); }
      catch (error) { log(index, { type: 'game_checkpoint_error', round: number, message: error.message }); }
      const view = await publicView(browser, index, number);
      writeJsonAtomic(CONTROL_FILE, control);
      publish(control, { run: index + 1, round: number, phase: 'waiting', roundStartedAt: null, roundEndsBy: null,
        summary: outcome.summary, nextWakeAt: run.nextWakeAt, ...view });
      if (run.consecutiveFailures >= 3) {
        run.status = 'blocked';
        log(index, { type: 'run_blocked', reason: 'Three consecutive incomplete rounds' });
        writeJsonAtomic(CONTROL_FILE, control);
        publish(control);
        break;
      }
      if (CONFIG.endsOnInfinityClaim && outcome.infinityReached) {
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
    publish(control, { run: index + 1, phase: 'reviewing', nextWakeAt: null });
  }
  if (run.status === 'retrospective_failed') {
    run.status = 'retrospective';
    log(index, { type: 'retrospective_retry' });
    writeJsonAtomic(CONTROL_FILE, control);
  }
  if (run.status === 'retrospective') {
    try {
      run.retrospective = await retrospect({ inheritedHandoff: run.inheritedHandoff, evidence: runEvidence(index, memory),
        onTranscript: entry => transcript(index, { phase: 'retrospective', ...entry }) });
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
    const previousHarness = control.harness ?? null;
    control.harness = sourceProvenance({ cwd: ROOT });
    writeJsonAtomic(CONTROL_FILE, control);
    publish(control);
    for (let index = 0; index < LIMITS.playthroughs; index++) {
      if (control.runs[index]?.status === 'complete') continue;
      if (index && control.runs[index - 1]?.status !== 'complete') break;
      await executeRun(control, index, previousHarness);
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
