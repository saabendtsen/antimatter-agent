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
    const activeTab = await this.page.locator('.o-tab-btn--active').first().elementHandle();
    try {
      await this.page.getByText('Options', { exact: true }).first().click();
      await this.page.getByRole('button', { name: 'Save game' }).click();
    } finally {
      if (activeTab) await activeTab.click().catch(() => {});
    }
  }

  async close() { if (this.context) await this.context.close(); }
}
