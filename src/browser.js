import { chromium } from 'playwright';

export const GAME_URL = 'https://ivark.github.io/AntimatterDimensions/';
const GAME_ORIGIN = new URL(GAME_URL).origin;
const CONTROL_SELECTOR = 'button, a, [role="button"], input[type="button"], input[type="submit"], .o-tab-btn';

export class GameBrowser {
  constructor(profileDir) {
    this.profileDir = profileDir;
    this.context = null;
    this.page = null;
  }

  async open() {
    this.context = await chromium.launchPersistentContext(this.profileDir, {
      headless: false,
      viewport: { width: 1440, height: 900 },
      args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
    });
    this.page = this.context.pages()[0] ?? await this.context.newPage();
    this.context.on('page', page => {
      if (page !== this.page) page.close().catch(() => {});
    });
    await this.page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (['https:', 'http:'].includes(url.protocol) && url.origin !== GAME_ORIGIN) {
        return route.abort();
      }
      return route.continue();
    });
    if (!this.page.url().startsWith(GAME_URL)) await this.home();
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForFunction(() => document.body?.innerText?.includes('antimatter'), undefined, { timeout: 20000 });
    await this.page.locator('#loading').waitFor({ state: 'hidden', timeout: 20000 });
  }

  async home() {
    await this.page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await this.page.locator('#loading').waitFor({ state: 'hidden', timeout: 20000 });
  }
  async back() {
    await this.page.goBack({ waitUntil: 'domcontentloaded', timeout: 15000 });
    if (!this.page.url().startsWith(GAME_URL)) await this.home();
    else await this.page.locator('#loading').waitFor({ state: 'hidden', timeout: 20000 });
  }

  async controls() {
    return this.page.locator(CONTROL_SELECTOR).evaluateAll(elements => elements
      .map((el, domIndex) => ({ el, domIndex }))
      .filter(({ el }) => {
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || !el.getClientRects().length) return false;
        const rect = el.getBoundingClientRect();
        const x = Math.max(0, Math.min(innerWidth - 1, rect.left + rect.width / 2));
        const y = Math.max(0, Math.min(innerHeight - 1, rect.top + rect.height / 2));
        if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= innerWidth || rect.top >= innerHeight) return false;
        const target = document.elementFromPoint(x, y);
        return target === el || el.contains(target);
      })
      .slice(0, 180)
      .map(({ el, domIndex }, index) => ({
        index, domIndex,
        label: (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 140),
        disabled: Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true'),
        kind: el.tagName.toLowerCase(),
      })));
  }

  async observe() {
    const title = await this.page.title();
    // The rotating joke ticker is visible but not game state. Its long text changes
    // continually and would consume the player's context budget each round.
    const text = await this.page.locator('body').evaluate(body => {
      const ticker = body.querySelector('.c-news-ticker')?.innerText ?? '';
      return body.innerText.replace(ticker, '').trim().slice(0, 14000);
    });
    const controls = await this.controls();
    return { title, url: this.page.url(), text, controls };
  }

  async click(index) {
    const controls = await this.controls();
    const control = controls[index];
    if (!control || control.disabled) throw new Error('Control missing or disabled; inspect the page again');
    const locator = this.page.locator(CONTROL_SELECTOR).nth(control.domIndex);
    const href = await locator.getAttribute('href');
    if (href && !new URL(href, this.page.url()).href.startsWith(GAME_URL)) throw new Error('Off-game link blocked');
    await locator.click({ timeout: 4000 });
    await this.page.waitForTimeout(350);
    if (!this.page.url().startsWith(GAME_URL)) {
      await this.home();
      throw new Error('Off-game navigation blocked');
    }
    return this.observe();
  }

  async scroll(direction) {
    await this.page.mouse.move(1200, 650);
    await this.page.mouse.wheel(0, direction === 'up' ? -650 : 650);
    await this.page.waitForTimeout(250);
    return this.observe();
  }

  async screenshot(file) {
    await this.page.screenshot({ path: file, fullPage: false });
  }

  async capture() {
    return this.page.screenshot({ type: 'png', fullPage: false });
  }

  async checkpoint() {
    // Use the game's own Save game button. Browser storage may otherwise lag the
    // visible state by its 30-second autosave interval when a process restarts.
    // The game reopens each tab on its last subtab, so clicking Options alone can land on
    // Visual or Gameplay, which have no Save game button (pre-pilot run 3, round 4). Open the
    // Saving subtab directly. Autosave is silent, so a new "Game saved" notice confirms that
    // the game accepted this manual save.
    const active = await this.page.evaluate(() => {
      const tab = document.querySelector('.o-tab-btn--active');
      const label = tab?.querySelector('.l-tab-btn-inner')?.innerText.trim();
      return label ? { label, subtab: [...tab.querySelectorAll('.o-tab-btn--subtab')]
        .findIndex(subtab => subtab.classList.contains('o-subtab-btn--active')) } : null;
    });
    const tabButton = label => this.page.locator('.o-tab-btn--subtabs')
      .filter({ has: this.page.getByText(label, { exact: true }) }).first();
    const seen = await this.page.evaluateHandle(() => new Set(document.querySelectorAll('.o-notification')));
    try {
      const options = tabButton('Options');
      await options.hover({ timeout: 5000 });
      await options.locator('.o-tab-btn--subtab', { hasText: 'Saving' }).click({ timeout: 5000 });
      await this.page.getByRole('button', { name: 'Save game', exact: true }).click({ timeout: 5000 });
      await this.page.waitForFunction(seen => [...document.querySelectorAll('.o-notification')]
        .some(note => !seen.has(note) && note.innerText.includes('Game saved')), seen, { timeout: 5000 })
        .catch(() => { throw new Error('Save game was clicked but the game showed no "Game saved" notice'); });
    } finally {
      await seen.dispose().catch(() => {});
      if (active) {
        const tab = tabButton(active.label);
        await (active.subtab >= 0
          ? tab.hover({ timeout: 5000 }).then(() => tab.locator('.o-tab-btn--subtab').nth(active.subtab).click({ timeout: 5000 }))
          : tab.click({ timeout: 5000 })).catch(() => {});
      }
    }
  }

  async close() { if (this.context) await this.context.close(); }
}
