import { spawnSync } from 'node:child_process';

const COMMIT = /^[0-9a-f]{7,40}$/;

// Records which harness source a controller process runs, so a run's behaviour can be tied to code.
// Git may be missing at runtime (no binary, no .git, exported tree); provenance is then explicitly
// unknown rather than guessed. ANTIMATTER_SOURCE_COMMIT lets a packaged run state its commit instead.
// Only the commit, a dirty flag and a short reason code are kept: no paths, output or environment.
export function sourceProvenance({ cwd, env = process.env, run = spawnSync } = {}) {
  const git = args => {
    try {
      const result = run('git', args, { cwd, encoding: 'utf8', shell: false, timeout: 5000, windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'] });
      return !result || result.error || result.status !== 0 ? null : String(result.stdout ?? '').trim();
    } catch { return null; }
  };
  const head = git(['rev-parse', 'HEAD']);
  if (head && COMMIT.test(head)) {
    const status = git(['status', '--porcelain', '--untracked-files=no']);
    return { commit: head, dirty: status === null ? null : status.length > 0, source: 'git' };
  }
  const declared = String(env.ANTIMATTER_SOURCE_COMMIT ?? '').trim().toLowerCase();
  if (COMMIT.test(declared)) return { commit: declared, dirty: null, source: 'env' };
  return { commit: null, dirty: null, source: 'unknown', reason: head === null ? 'git_unavailable' : 'git_unrecognised' };
}

// A controller restart can resume an active run on different code after an arbitrary pause. The
// resume event records both, so later rounds are not silently attributed to the run's start commit.
export function resumeRecord({ run, previousHarness, harness, lastEvent, now = Date.now() }) {
  const lastAt = Date.parse(lastEvent?.at ?? '');
  const knownCommits = previousHarness?.commit && harness?.commit;
  return {
    type: 'controller_resume',
    status: run.status,
    roundsPlayed: run.round,
    harness,
    previousCommit: previousHarness?.commit ?? null,
    runStartCommit: run.harness?.commit ?? null,
    commitChanged: knownCommits ? previousHarness.commit !== harness.commit : null,
    lastEventType: lastEvent?.type ?? null,
    lastEventAt: lastEvent?.at ?? null,
    gapSeconds: Number.isFinite(lastAt) ? Math.max(0, Math.round((now - lastAt) / 1000)) : null,
  };
}
