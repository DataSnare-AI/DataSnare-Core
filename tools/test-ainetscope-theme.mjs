import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, open: false } });
let browser;
const output = await mkdtemp(join(tmpdir(), 'datasnare-theme-'));
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await page.addInitScript(() => { if (!localStorage.getItem('datasnare:core-skin')) localStorage.setItem('datasnare:core-skin', 'dark'); });
    await page.goto(`${server.resolvedUrls.local[0]}ainetscope/index.html`);
    assert.equal(await page.locator('html').getAttribute('data-skin'), 'dark');
    const picker = page.getByRole('group', { name: 'Suite palette', exact: true });
    for (const theme of ['Modern', 'Light', 'Dark']) {
      await picker.getByRole('button', { name: theme, exact: true }).click();
      assert.equal(await page.locator('html').getAttribute('data-skin'), theme.toLowerCase());
      assert.equal(await page.evaluate(() => localStorage.getItem('datasnare:core-skin')), theme.toLowerCase());
    }
    await page.reload();
    assert.equal(await page.locator('html').getAttribute('data-skin'), 'dark');
    await page.locator('#demoButton').evaluate(button => button.click());
    await page.waitForFunction(() => state.packets.length > 0);
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save Session', exact: true }).click();
    const sessionPath = join(output, `theme-session-${width}.json`);
    await (await pending).saveAs(sessionPath);
    await picker.getByRole('button', { name: 'Light', exact: true }).click();
    await page.locator('#sessionRestoreInput').setInputFiles(sessionPath);
    await page.waitForFunction(() => document.documentElement.dataset.skin === 'dark');
    await page.getByRole('button', { name: 'Two-Sided', exact: true }).click();
    assert.equal(await page.locator('#twoSidedScroll').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(34, 42, 48)');
    await page.screenshot({ path: join(output, `dark-${width}.png`), fullPage: true });
    await picker.getByRole('button', { name: 'Light', exact: true }).click();
    await page.screenshot({ path: join(output, `light-${width}.png`), fullPage: true });
    assert.deepEqual(errors, []);
    const layout = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(layout.width <= layout.viewport + 1);
    console.log(`PASS ${width}px palette: Core preference, all themes, reload, session restore and Two-Sided surfaces`);
    await page.close();
  }
  console.log(`Screenshots: ${output}`);
} finally { await browser?.close(); await server.close(); }