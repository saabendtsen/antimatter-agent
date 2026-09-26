import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const malicious = '<img src=x onerror="window.__injected = true">';

test('public viewer renders current state and treats player text as text', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 840 } });
    await page.route('http://viewer.test/**', route => {
      if (route.request().url().includes('/data/latest.json')) {
        return route.fulfill({ json: {
          mode: 'prepilot', status: 'active', updatedAt: '2026-09-26T19:00:00Z',
          current: { run: 2, round: 4, summary: malicious, antimatter: '10 K', production: '20', pageText: 'Visible game state', screenshot: null },
          runs: [{ number: 1, status: 'complete', rounds: 30, inheritedHandoff: '',
            retrospective: { inheritedAssessment: 'none', reason: 'First run', handoff: 'Try higher dimensions.' },
            decisions: [{ at: '2026-09-26T19:00:00Z', round: 1, summary: malicious }] }],
        } });
      }
      return route.fulfill({ status: 200, contentType: 'text/html', body: html });
    });
    await page.goto('http://viewer.test/');
    await page.getByText('Run 1 · complete · 30 rounds').waitFor();
    assert.equal(await page.locator('#antimatter').innerText(), '10 K');
    assert.equal(await page.locator('#production').innerText(), '20');
    assert.equal(await page.locator('#decision').innerText(), malicious);
    assert.equal(await page.locator('img[src="x"]').count(), 0);
    assert.equal(await page.evaluate(() => window.__injected === true), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  } finally { await browser.close(); }
});
