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
