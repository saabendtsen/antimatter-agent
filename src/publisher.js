import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(ROOT, 'publication');
const destination = process.env.ANTIMATTER_PUBLIC_DIR || '/srv/homelab-deploy/antimatter-agent/data';
const host = process.env.ANTIMATTER_PUBLIC_HOST || 'home-server';
const interval = Number(process.env.ANTIMATTER_PUBLISH_INTERVAL || 60);

function run(program, args) {
  const result = spawnSync(program, args, { stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${program} exited ${result.status}`);
}

export function publishOnce() {
  const files = ['latest.json', 'screen.png'].filter(name => fs.existsSync(path.join(source, name)));
  if (!files.includes('latest.json')) throw new Error('No public snapshot exists yet');
  run('ssh', [host, 'mkdir', '-p', destination]);
  if (files.includes('screen.png')) run('scp', [path.join(source, 'screen.png'), `${host}:${destination}/screen.png`]);
  run('scp', [path.join(source, 'latest.json'), `${host}:${destination}/latest.json.tmp`]);
  run('ssh', [host, 'mv', `${destination}/latest.json.tmp`, `${destination}/latest.json`]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const once = process.argv.includes('--once');
  const loop = async () => {
    do {
      try { publishOnce(); console.log(`Published at ${new Date().toISOString()}`); }
      catch (error) { console.error(`Publish failed: ${error.message}`); if (once) process.exitCode = 1; }
      if (once) break;
      await new Promise(resolve => setTimeout(resolve, interval * 1000));
    } while (true);
  };
  loop();
}
