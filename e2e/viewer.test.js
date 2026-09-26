import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const malicious = '<img src=x onerror="window.__injected = true">';
const scriptish = '<script>window.__injected = true</script>';
const NOW = Date.parse('2026-09-26T19:05:00Z');
const MOBILE = { width: 390, height: 840 };
const DESKTOP = { width: 1280, height: 900 };

function usage(peakTokens) {
  return { peakTokens, contextWindow: 120000, peakPercent: Math.round(peakTokens / 120000 * 1000) / 10, ceilingTokens: 84000, ceilingReached: peakTokens >= 84000 };
}

function snapshot(overrides = {}) {
  return {
    mode: 'prepilot', status: 'active', updatedAt: new Date(NOW - 2 * 60 * 1000).toISOString(),
    current: { run: 2, round: 4, summary: malicious, antimatter: '10 K', production: '20',
      pageText: scriptish, screenshot: 'screen.png?v=123', nextWakeAt: null },
    runs: [
      { number: 1, status: 'complete', startedAt: '2026-09-26T17:00:00Z', endedAt: '2026-09-26T18:00:00Z', rounds: 30,
        durationSeconds: 3600, infinityClaimed: false, summary: 'Bought dimensions.', inheritedHandoff: '',
        retrospective: { inheritedAssessment: 'none', reason: 'First run', handoff: `Try higher dimensions. ${malicious}` },
        decisions: [{ at: '2026-09-26T17:02:00Z', round: 1, summary: malicious, appliedWakeSeconds: 0, contextUsage: usage(30000) }] },
      { number: 2, status: 'active', startedAt: '2026-09-26T18:30:00Z', endedAt: null, rounds: 4, durationSeconds: null,
        infinityClaimed: false, summary: 'Saved for a tickspeed upgrade.', inheritedHandoff: `Try higher dimensions. ${scriptish}`, retrospective: null,
        decisions: [
          { at: '2026-09-26T19:00:00Z', round: 3, summary: 'Bought first dimension.', appliedWakeSeconds: 0, contextUsage: usage(90000), incomplete: true },
          { at: '2026-09-26T19:03:00Z', round: 4, summary: malicious, appliedWakeSeconds: 0, contextUsage: usage(30000) },
        ] },
    ],
    ...overrides,
  };
}

// responder(url) returns a route.fulfill options object, or 'abort' to simulate a network failure.
async function openViewer(browser, viewport, responder, simulateOffline = false) {
  const page = await browser.newPage({ viewport, locale: 'en-US', timezoneId: 'UTC' });
  if (simulateOffline) await page.addInitScript(() => Object.defineProperty(navigator, 'onLine', { get: () => false }));
  await page.clock.install({ time: NOW });
  const state = { responder, requests: 0 };
  await page.route('http://viewer.test/**', route => {
    const url = route.request().url();
    if (url.includes('/data/latest.json')) {
      state.requests += 1;
      const reply = state.responder(url);
      return reply === 'abort' ? route.abort('internetdisconnected') : route.fulfill(reply);
    }
    if (url.includes('/data/screen.png')) return route.fulfill({ status: 200, contentType: 'image/png', body: png });
    return route.fulfill({ status: 200, contentType: 'text/html', body: html });
  });
  await page.goto('http://viewer.test/');
  return { page, state };
}

async function assertNoInjection(page) {
  assert.equal(await page.locator('img[src="x"]').count(), 0);
  assert.equal(await page.locator('#runs script, #page-text script').count(), 0);
  assert.equal(await page.evaluate(() => window.__injected === true), false);
}

async function assertNoHorizontalOverflow(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
}

async function withBrowser(fn) {
  const browser = await chromium.launch();
  try { await fn(browser); } finally { await browser.close(); }
}

test('mobile viewer shows live state, screenshot, handoffs and decisions as plain text', () => withBrowser(async browser => {
  const { page } = await openViewer(browser, MOBILE, () => ({ json: snapshot() }));
  await page.locator('#connection[data-state="live"]').waitFor();
  assert.equal(await page.locator('#connection-title').innerText(), 'Live');
  assert.match(await page.locator('#freshness').innerText(), /Data updated 2 min ago/);
  assert.equal(await page.locator('#progress').innerText(), 'Pre-pilot · run 2 of 3 · round 4 of 30');
  assert.equal(await page.locator('#antimatter').innerText(), '10 K');
  assert.equal(await page.locator('#production').innerText(), '20');
  assert.equal(await page.locator('#next-round').innerText(), 'Immediately');
  assert.equal(await page.locator('#decision').innerText(), malicious);
  assert.match(await page.locator('#decision-meta').innerText(), /Round 4 · .* Peak context: 30,000 \/ 120,000 tokens \(25%\)/);
  assert.equal(await page.locator('#page-text').textContent(), scriptish);

  const screen = page.getByRole('img', { name: 'Game screenshot after round 4 of run 2' });
  await screen.waitFor();
  assert.equal(await screen.getAttribute('src'), './data/screen.png?v=123');
  assert.equal(await screen.evaluate(image => image.complete && image.naturalWidth > 0), true);
  assert.equal(await page.locator('#screen-placeholder').isHidden(), true);

  const active = page.locator('.run[data-run="2"]');
  assert.match(await active.innerText(), /Playing/);
  assert.match(await active.innerText(), /4 \/ 30 rounds/);
  assert.match(await active.innerText(), /max context 75%/);
  assert.equal(await active.locator('.handoff').first().innerText(), `Inherited handoff\nTry higher dimensions. ${scriptish}`);
  assert.match(await active.innerText(), /Outgoing handoff: written when this playthrough ends/);
  // The active run's decisions are open by default, newest first.
  assert.equal(await active.locator('details').evaluate(node => node.open), true);
  const items = active.locator('li');
  assert.equal(await items.count(), 2);
  assert.equal(await items.nth(0).locator('.decision-text').textContent(), malicious);
  assert.match(await items.nth(0).innerText(), /Peak context: 30,000 \/ 120,000 tokens \(25%\) · next round immediate/);
  assert.match(await items.nth(1).innerText(), /action ceiling reached/);
  assert.match(await items.nth(1).innerText(), /Round ended incomplete/);

  const finished = page.locator('.run[data-run="1"]');
  assert.match(await finished.innerText(), /Complete/);
  assert.match(await finished.innerText(), /30 \/ 30 rounds · 1 h 0 min/);
  assert.match(await finished.innerText(), /Inherited handoff\nNone/);
  assert.equal(await finished.locator('.handoff').last().innerText(), `Outgoing handoff\nTry higher dimensions. ${malicious}`);
  assert.equal(await finished.locator('details').evaluate(node => node.open), false);
  await finished.getByText('Decisions (1)').click();
  assert.equal(await finished.locator('li .decision-text').textContent(), malicious);

  await assertNoInjection(page);
  await assertNoHorizontalOverflow(page);
}));

test('desktop viewer lays current game beside playthroughs and keeps opened decisions open across refreshes', () => withBrowser(async browser => {
  const { page, state } = await openViewer(browser, DESKTOP, () => ({ json: snapshot() }));
  await page.locator('#connection[data-state="live"]').waitFor();
  const current = await page.locator('section[aria-labelledby="current-title"]').boundingBox();
  const runs = await page.locator('section[aria-labelledby="runs-title"]').boundingBox();
  assert.ok(runs.x > current.x + current.width - 1, 'playthroughs column sits to the right on desktop');
  assert.ok(Math.abs(runs.y - current.y) < 2);

  const finished = page.locator('.run[data-run="1"]');
  await finished.getByText('Decisions (1)').click();
  const before = state.requests;
  const polled = page.waitForResponse(response => response.url().includes('/data/latest.json'));
  await page.clock.fastForward(30000);
  await polled;
  await page.locator('#connection[data-state="live"]').waitFor();
  assert.ok(state.requests > before, 'viewer polls again after 30 s');
  assert.equal(await page.locator('.run[data-run="1"] details').evaluate(node => node.open), true);
  await assertNoInjection(page);
  await assertNoHorizontalOverflow(page);
}));

test('viewer marks old data as stale and rejects unsafe screenshot paths', () => withBrowser(async browser => {
  const data = snapshot({ updatedAt: new Date(NOW - 2 * 3600 * 1000).toISOString() });
  data.current.screenshot = 'javascript:window.__injected=true';
  const { page } = await openViewer(browser, MOBILE, () => ({ json: data }));
  await page.locator('#connection[data-state="stale"]').waitFor();
  assert.equal(await page.locator('#connection-title').innerText(), 'Stale — no new round recently');
  assert.match(await page.locator('#freshness').innerText(), /Data updated 2 h 0 min ago.*may have stopped/);
  assert.equal(await page.locator('#screen-link').isHidden(), true);
  assert.equal(await page.locator('#screen-placeholder').innerText(), 'No screenshot yet.');
  assert.equal(await page.locator('#screen').getAttribute('src'), null);
  await assertNoInjection(page);
}));

test('viewer becomes stale while the page stays open without new data', () => withBrowser(async browser => {
  const { page } = await openViewer(browser, DESKTOP, () => ({ json: snapshot() }));
  await page.locator('#connection[data-state="live"]').waitFor();
  await page.clock.fastForward(21 * 60 * 1000);
  assert.equal(await page.locator('#connection').getAttribute('data-state'), 'live', 'a full 20-minute round is not stale');
  await page.clock.fastForward(2 * 60 * 1000);
  await page.locator('#connection[data-state="stale"]').waitFor();
  assert.match(await page.locator('#freshness').innerText(), /Data updated 25 min ago/);
}));

test('soak viewer labels the mode and stays live through a planned wait', () => withBrowser(async browser => {
  const data = snapshot({ mode: 'soak', updatedAt: new Date(NOW - 16 * 60 * 1000).toISOString() });
  data.runs = [data.runs[1]];
  data.runs[0].number = 1;
  data.current.run = 1;
  // The maximum 10-minute wait was planned when round 4 ended 16 minutes ago.
  data.current.nextWakeAt = new Date(NOW - 6 * 60 * 1000).toISOString();
  data.current.phase = 'waiting';
  const { page } = await openViewer(browser, MOBILE, () => ({ json: data }));
  await page.locator('#connection[data-state="live"]').waitFor();
  assert.equal(await page.locator('#progress').innerText(), '4-hour soak · run 1 of 1 · round 4 · between rounds');
  assert.match(await page.locator('.run[data-run="1"]').innerText(), /4 rounds/);
  await page.clock.fastForward(17 * 60 * 1000);
  assert.equal(await page.locator('#connection').getAttribute('data-state'), 'live');
  await page.clock.fastForward(2 * 60 * 1000);
  await page.locator('#connection[data-state="stale"]').waitFor();
}));

test('a new playthrough is announced without the previous game screenshot, text or decision', () => withBrowser(async browser => {
  const data = snapshot({ updatedAt: new Date(NOW - 30 * 1000).toISOString() });
  data.runs[1] = { ...data.runs[1], status: 'complete', endedAt: '2026-09-26T19:04:00Z', durationSeconds: 2040,
    retrospective: { inheritedAssessment: 'useful', reason: 'Helped', handoff: 'Buy tickspeed early.' } };
  data.runs.push({ number: 3, status: 'active', startedAt: new Date(NOW - 30 * 1000).toISOString(), endedAt: null, rounds: 0,
    durationSeconds: null, infinityClaimed: false, summary: '', inheritedHandoff: 'Buy tickspeed early.', retrospective: null, decisions: [] });
  data.current = { run: 3, round: null, phase: 'starting', roundStartedAt: null, roundEndsBy: null, summary: '', pageText: '',
    screenshot: null, nextWakeAt: null, antimatter: null, production: null };
  const { page } = await openViewer(browser, MOBILE, () => ({ json: data }));
  await page.locator('#connection[data-state="live"]').waitFor();
  assert.equal(await page.locator('#progress').innerText(), 'Pre-pilot · run 3 of 3 · starting playthrough');
  assert.equal(await page.locator('#next-round').innerText(), 'Starting');
  assert.equal(await page.locator('#antimatter').innerText(), '—');
  assert.equal(await page.locator('#screen-link').isHidden(), true);
  assert.equal(await page.locator('#screen-placeholder').innerText(), "Waiting for the new playthrough's first screenshot.");
  assert.equal(await page.locator('#decision').innerText(), 'Waiting for the first round.');
  assert.equal(await page.locator('#decision-meta').innerText(), '');
  assert.equal(await page.locator('#page-text').textContent(), '');
  const active = page.locator('.run[data-run="3"]');
  assert.match(await active.innerText(), /Playing/);
  assert.match(await active.innerText(), /0 \/ 30 rounds/);
  assert.equal(await active.locator('details').evaluate(node => node.open), true);
  await assertNoInjection(page);
}));

test('a round in progress shows its start observation and stays live for its full twenty minutes', () => withBrowser(async browser => {
  const data = snapshot({ updatedAt: new Date(NOW - 60 * 1000).toISOString() });
  data.runs[1].rounds = 5;
  data.current = { ...data.current, round: 5, phase: 'playing', summary: 'Saved for a tickspeed upgrade.', antimatter: '12 K',
    roundStartedAt: new Date(NOW - 60 * 1000).toISOString(), roundEndsBy: new Date(NOW + 19 * 60 * 1000).toISOString(),
    screenshot: 'screen.png?v=456' };
  const { page } = await openViewer(browser, DESKTOP, () => ({ json: data }));
  await page.locator('#connection[data-state="live"]').waitFor();
  assert.equal(await page.locator('#progress').innerText(), 'Pre-pilot · run 2 of 3 · round 5 of 30 · round in progress');
  assert.equal(await page.locator('#next-round').innerText(), 'Now, until 7:24:00 PM');
  assert.equal(await page.locator('#antimatter').innerText(), '12 K');
  assert.equal(await page.locator('#screen-caption').innerText(), 'Screenshot at the start of round 5. Select it to open full size.');
  await page.getByRole('img', { name: 'Game screenshot at the start of round 5 of run 2' }).waitFor();
  // The last completed decision (round 4) stays labelled as such while round 5 plays.
  assert.equal(await page.locator('#decision').innerText(), 'Saved for a tickspeed upgrade.');
  assert.match(await page.locator('#decision-meta').innerText(), /^Round 4 · /);
  await page.clock.fastForward(22 * 60 * 1000);
  assert.equal(await page.locator('#connection').getAttribute('data-state'), 'live');
  await page.clock.fastForward(2 * 60 * 1000);
  await page.locator('#connection[data-state="stale"]').waitFor();
  await assertNoInjection(page);
}));

test('viewer keeps last data visible and reports offline when fetches fail, then recovers', () => withBrowser(async browser => {
  const { page, state } = await openViewer(browser, MOBILE, () => ({ json: snapshot() }), true);
  await page.locator('#connection[data-state="live"]').waitFor();
  state.responder = () => ({ status: 503, body: 'unavailable' });
  await page.clock.fastForward(30000);
  await page.locator('#connection[data-state="offline"]').waitFor();
  assert.equal(await page.locator('#connection-title').innerText(), 'Offline — showing last received data');
  assert.match(await page.locator('#freshness').innerText(), /Last fetch failed: HTTP 503/);
  assert.equal(await page.locator('#antimatter').innerText(), '10 K');
  assert.equal(await page.locator('.run').count(), 2);

  state.responder = () => 'abort';
  await page.clock.fastForward(30000);
  await page.locator('#freshness', { hasNotText: /HTTP 503/ }).waitFor();
  assert.equal(await page.locator('#connection').getAttribute('data-state'), 'offline');

  state.responder = () => ({ json: snapshot({ updatedAt: new Date(NOW + 60 * 1000).toISOString(), current: { ...snapshot().current, antimatter: '20 K' } }) });
  await page.clock.fastForward(30000);
  await page.locator('#connection[data-state="live"]').waitFor();
  assert.equal(await page.locator('#antimatter').innerText(), '20 K');
  await assertNoHorizontalOverflow(page);
}));

test('viewer explains a missing or malformed data file before any data arrives', () => withBrowser(async browser => {
  const { page, state } = await openViewer(browser, MOBILE, () => ({ status: 404, body: 'not found' }), true);
  await page.locator('#connection[data-state="error"]').waitFor();
  assert.equal(await page.locator('#connection-title').innerText(), 'Cannot load data yet');
  assert.match(await page.locator('#freshness').innerText(), /No data published yet \(HTTP 404\)\. Retrying every 30 s/);
  assert.equal(await page.locator('#runs').innerText(), 'No playthrough data yet.');

  state.responder = () => ({ status: 200, contentType: 'application/json', body: '{not json' });
  await page.clock.fastForward(30000);
  await page.locator('#freshness', { hasText: 'Data file is not valid JSON' }).waitFor();

  state.responder = () => ({ json: snapshot({ status: 'complete', updatedAt: new Date(NOW - 5 * 3600 * 1000).toISOString() }) });
  await page.clock.fastForward(30000);
  await page.locator('#connection[data-state="finished"]').waitFor();
  assert.equal(await page.locator('#next-round').innerText(), 'Stopped');
}));
