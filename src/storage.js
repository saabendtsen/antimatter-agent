import fs from 'node:fs';
import path from 'node:path';

export function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(temp, file);
}

export function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function appendEvent(file, event) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n');
}

// appendEvent writes one line per call, so a process killed mid-write can leave only a torn final
// line without its newline. On controller start that tail is copied to a sidecar file for diagnosis
// and cut off, so later appends start on a clean line. A final line that is complete JSON but lost
// only its newline is kept and given the newline. Every newline-terminated line must still parse:
// a malformed earlier record is not a crash artefact, and recovery throws instead of dropping history.
export function recoverEventLog(file, now = Date.now()) {
  if (!fs.existsSync(file)) return null;
  const bytes = fs.readFileSync(file);
  const end = bytes.lastIndexOf(0x0a) + 1;
  bytes.subarray(0, end).toString('utf8').split(/\r?\n/).forEach((line, index) => {
    if (!line) return;
    try { JSON.parse(line); }
    catch { throw new Error(`Malformed event record at line ${index + 1} of ${file}; not a torn tail, refusing to recover`); }
  });
  const tail = bytes.subarray(end);
  if (!tail.length) return null;
  try {
    JSON.parse(tail.toString('utf8'));
    fs.appendFileSync(file, '\n');
    return { tornBytes: 0, completedLine: true };
  } catch {}
  const preserved = `${file}.torn-${now}`;
  fs.writeFileSync(preserved, tail);
  fs.truncateSync(file, end);
  return { tornBytes: tail.length, preservedAs: path.basename(preserved) };
}

export function readEvents(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

export function wordCount(text) {
  return text.trim().split(/\s+/u).filter(Boolean).length;
}

export function safePublicText(text, max = 1200) {
  return String(text ?? '').replace(/[\u0000-\u001f]/g, ' ').slice(0, max);
}
