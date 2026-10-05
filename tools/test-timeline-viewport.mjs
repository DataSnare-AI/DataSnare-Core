import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, open: false } });
let browser;
try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const screenshots = await mkdtemp(join(tmpdir(), 'datasnare-timeline-'));
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const html = await server.transformIndexHtml('/__timeline-regression', '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/tools/fixtures/timeline-viewport.jsx"></script></body></html>');
    await page.route('**/__timeline-regression', route => route.fulfill({ contentType: 'text/html', body: html }));
    await page.goto(`${origin}__timeline-regression`);
    const span = page.getByRole('spinbutton', { name: 'Visible timeline span in milliseconds' });
    await span.fill('801');
    await page.waitForFunction(() => document.querySelector('.analysis-timeline__marker') !== null);
    const snapshot = () => page.evaluate(() => ({
      start: document.querySelector('[aria-label="Visible timeline start in local time"]').value,
      span: document.querySelector('[aria-label="Visible timeline span in milliseconds"]').value,
      window: ['x', 'width'].map(attribute => document.querySelector('.analysis-timeline__window--investigation').getAttribute(attribute)),
      handles: [...document.querySelectorAll('.analysis-timeline__window-handle')].map(handle => handle.getAttribute('aria-valuenow')),
      markers: [...document.querySelectorAll('.analysis-timeline__marker')].map(marker => marker.getAttribute('cx')),
    }));
    const before = await snapshot();
    assert.equal(before.span, '801');
    assert.equal(before.markers.length, 1);
    assert.equal(before.handles.length, 2);
    await page.getByRole('button', { name: 'Add distant trace' }).click();
    await page.getByRole('status').filter({ hasText: '2 / 2' }).waitFor();
    assert.deepEqual(await snapshot(), before, 'Adding a distant trace must preserve the rendered viewport, markers and window');
    await page.getByRole('button', { name: 'Remove distant trace' }).click();
    await page.getByRole('status').filter({ hasText: '1 / 1' }).waitFor();
    assert.deepEqual(await snapshot(), before, 'Removing a distant trace must preserve the rendered viewport, markers and window');
    await page.getByRole('slider', { name: 'Resize investigation window end', exact: true }).press('ArrowRight');
    const resized = await snapshot();
    assert.equal(Number(resized.handles[1]), Number(before.handles[1]) + 1);
    assert.deepEqual(errors, [], 'The fixture must render without runtime errors');
    await page.screenshot({ path: join(screenshots, `timeline-${viewport.width}.png`), fullPage: true });
    console.log(`PASS ${viewport.width}px: add/remove preserves 801ms viewport, marker and window; resize remains interactive`);
    await page.close();
  }
  console.log(`Screenshots: ${screenshots}`);
} finally {
  await browser?.close();
  await server.close();
}