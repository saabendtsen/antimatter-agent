import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { GameBrowser } from '../src/browser.js';

// A small offline stand-in for the game's tab bar, matching the live classes: subtab buttons
// appear on hover, and each tab reopens on the subtab it last showed. Only Options > Saving has
// the Save game button, and a manual save shows a "Game saved" notice when the game accepts it.
const GAME = `<!doctype html><style>
  .o-tab-btn--subtabs { display: inline-block; position: relative; padding: 8px; }
  .subtabs { display: none; position: absolute; top: 100%; left: 0; }
  .o-tab-btn--subtabs:hover .subtabs { display: block; }
  .o-tab-btn--subtab { display: block; padding: 6px; }
  #page { margin-top: 80px; }
</style>
<div id="tabs"></div><div id="page"></div><div class="l-notification-container"></div>
<script>
  const tabs = { Dimensions: ['Antimatter Dimensions'], Options: ['Saving', 'Visual', 'Gameplay'] };
  const last = { Dimensions: 'Antimatter Dimensions', Options: 'Saving' };
  const content = { 'Antimatter Dimensions': '<button>Max All (M)</button>', Visual: '<button>Theme</button>',
    Gameplay: '<button>Offline progress: ON</button>' };
  window.game = { tab: 'Dimensions', saves: 0, canSave: true, saveButton: true };
  function show(tab, subtab = last[tab]) {
    game.tab = tab;
    last[tab] = subtab;
    render();
  }
  function save() {
    if (!game.canSave) return;
    game.saves += 1;
    const note = document.createElement('div');
    note.className = 'o-notification o-notification--info';
    note.textContent = 'Game saved';
    document.querySelector('.l-notification-container').append(note);
  }
  function render() {
    document.getElementById('tabs').innerHTML = Object.entries(tabs).map(([tab, subtabs]) =>
      '<div class="o-tab-btn o-tab-btn--subtabs' + (game.tab === tab ? ' o-tab-btn--active' : '') + '" data-tab="' + tab + '">' +
      '<div class="l-tab-btn-inner">' + tab + '</div><div class="subtabs">' + subtabs.map(subtab =>
        '<div class="o-tab-btn o-tab-btn--subtab' + (last[tab] === subtab ? ' o-subtab-btn--active' : '') +
        '" data-tab="' + tab + '" data-subtab="' + subtab + '"><div class="o-subtab__tooltip">' + subtab + '</div></div>').join('') +
      '</div></div>').join('');
    const subtab = last[game.tab];
    document.getElementById('page').innerHTML = subtab === 'Saving'
      ? (game.saveButton ? '<button onclick="save()">Save game</button>' : '') + '<button>Export save</button>'
      : content[subtab];
  }
  document.getElementById('tabs').addEventListener('click', event => {
    const subtab = event.target.closest('.o-tab-btn--subtab');
    if (subtab) return show(subtab.dataset.tab, subtab.dataset.subtab);
    const tab = event.target.closest('.o-tab-btn--subtabs');
    if (tab) show(tab.dataset.tab);
  });
  render();
</script>`;

async function openGame(browser, setup) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.setContent(GAME);
  await page.evaluate(setup);
  const game = new GameBrowser('unused-profile');
  game.page = page;
  const view = () => page.evaluate(() => ({ tab: game.tab, subtab: document.querySelector('.o-tab-btn--active .o-subtab-btn--active')
    ?.dataset.subtab, saves: game.saves }));
  return { page, game, view };
}

test('checkpoint', async t => {
  const browser = await chromium.launch();
  t.after(() => browser.close());

  await t.test('saves through the Saving subtab when Options last showed Gameplay, then restores the tab', async () => {
    const { game, view } = await openGame(browser, () => { show('Options', 'Gameplay'); show('Dimensions'); });
    await game.checkpoint();
    assert.deepEqual(await view(), { tab: 'Dimensions', subtab: 'Antimatter Dimensions', saves: 1 });
  });

  await t.test('returns the player to the Options subtab they were on', async () => {
    const { game, view } = await openGame(browser, () => show('Options', 'Gameplay'));
    await game.checkpoint();
    assert.deepEqual(await view(), { tab: 'Options', subtab: 'Gameplay', saves: 1 });
  });

  await t.test('fails without claiming success when the game does not confirm the save', async () => {
    const { game, view } = await openGame(browser, () => { save(); game.canSave = false; });
    await assert.rejects(game.checkpoint(), /no "Game saved" notice/);
    assert.deepEqual(await view(), { tab: 'Dimensions', subtab: 'Antimatter Dimensions', saves: 1 });
  });

  await t.test('fails quickly and restores the tab when the Save game button is missing', async () => {
    const { game, view } = await openGame(browser, () => { game.saveButton = false; render(); });
    const started = Date.now();
    await assert.rejects(game.checkpoint(), /Save game/);
    assert.ok(Date.now() - started < 15000);
    assert.deepEqual(await view(), { tab: 'Dimensions', subtab: 'Antimatter Dimensions', saves: 0 });
  });
});
