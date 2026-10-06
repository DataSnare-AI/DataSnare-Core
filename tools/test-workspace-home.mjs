import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = fileURLToPath(new URL('../', import.meta.url));
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, open: false } });
const screenshots = await mkdtemp(join(tmpdir(), 'datasnare-home-'));
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/health/readiness', route => route.fulfill({ json: { status: 'ready', checks: {}, environment: 'development' } }));
    await page.route('**/api/projects/web-migrations', route => route.fulfill({ json: { projects: [] } }));
    await page.goto(server.resolvedUrls.local[0]);
    const cards = page.locator('.project-card');
    await cards.first().waitFor();
    assert.deepEqual(await cards.locator('h3').allTextContents(), ['DataSnare-AIAnalysis', 'DataSnare-AIOps', 'DataSnare-Core']);
    const links = cards.getByRole('link', { name: 'Open in new tab' });
    assert.deepEqual(await links.evaluateAll(elements => elements.map(element => ({ href: element.getAttribute('href'), target: element.target, rel: element.rel }))), [
      { href: '/aianalysis', target: '_blank', rel: 'noopener noreferrer' },
      { href: 'https://datasnare-aiops.com', target: '_blank', rel: 'noopener noreferrer' },
      { href: '/', target: '_blank', rel: 'noopener noreferrer' },
    ]);
    assert.equal(await page.locator('.core-workspace-heading .eyebrow').count(), 0);
    assert.equal(await page.locator('.core-workspace-heading a').count(), 0);
    const layout = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(layout.width <= layout.viewport + 1, `Home page overflow: ${JSON.stringify(layout)}`);
    await page.screenshot({ path: join(screenshots, `workspace-${width}.png`), fullPage: true });
    await cards.first().getByRole('button', { name: 'Open project', exact: true }).click();
    await page.waitForURL('**/aianalysis');
    await page.getByRole('heading', { name: 'DataSnare AIAnalysis', exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px: three suite cards, correct new-tab links, clean heading and AIAnalysis navigation`);
    await page.close();
  }
  console.log(`Screenshots: ${screenshots}`);
} finally { await browser?.close(); await server.close(); }