import { readJson, writeJsonAtomic } from './storage.js';

export const WARM_LIMIT = 2200;
export const COLD_LIMIT = 12000;

export class GameMemory {
  constructor(file, onEvent = () => {}) {
    this.file = file;
    this.onEvent = onEvent;
    this.data = readJson(file, { warm: '', cold: {} });
  }

  warm() { return this.data.warm; }
  index() {
    return Object.entries(this.data.cold).map(([key, value]) => ({ key, title: value.title }));
  }
  read(key) {
    const found = this.data.cold[key] ?? null;
    this.onEvent({ type: 'memory_read', key, found: Boolean(found) });
    return found;
  }
  setWarm(text) {
    if (text.length > WARM_LIMIT) throw new Error(`Warm memory exceeds ${WARM_LIMIT} characters`);
    this.data.warm = text;
    this.save();
    this.onEvent({ type: 'memory_warm_write', characters: text.length, text });
  }
  put(key, title, text) {
    if (!/^[a-z0-9-]{1,40}$/.test(key)) throw new Error('Cold key must use lowercase letters, digits, or hyphens');
    if (title.length > 100 || text.length > 2500) throw new Error('Cold note too long');
    const next = { ...this.data.cold, [key]: { title, text } };
    if (JSON.stringify(next).length > COLD_LIMIT) throw new Error('Cold storage is full');
    this.data.cold = next;
    this.save();
    this.onEvent({ type: 'memory_cold_write', key, title, text });
  }
  delete(key) {
    if (!Object.hasOwn(this.data.cold, key)) return false;
    delete this.data.cold[key];
    this.save();
    this.onEvent({ type: 'memory_delete', key });
    return true;
  }
  save() { writeJsonAtomic(this.file, this.data); }
}
