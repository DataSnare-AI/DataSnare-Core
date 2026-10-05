import assert from 'node:assert/strict';
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
  const html = await server.transformIndexHtml('/__airca-regression', '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/tools/fixtures/airca-workbench.jsx"></script></body></html>');
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/__airca-regression', route => route.fulfill({ contentType: 'text/html', body: html }));
    await page.route('**/api/health/readiness', route => route.fulfill({ json: { environment: 'development' } }));
    await page.route('**/api/tenants/7/tools/airca/jobs', route => route.fulfill({ json: {
      schema: 'datasnare-airca/job-v1',
      job: { job_id: 'fixture-job', artifact_name: 'outage-review.json', state: 'queued', native_conversion: { strategy: 'airca-investigation-json-import', status: 'upload_required' } },
    } }));
    await page.route('**/api/tenants/7/tools/airca/jobs/fixture-job/artifact', route => route.fulfill({ json: {
      job: { job_id: 'fixture-job', artifact_name: 'outage-review.json', state: 'completed' },
      analysis: { event_count: 1, findings: [{ title: 'Root cause', detail: 'Connection pool exhausted' }], events: [{ timestamp: '2026-10-03T00:00:00.123Z', severity: 'warning', summary: 'Connection pool exhausted' }] },
    } }));
    await page.goto(`${origin}__airca-regression`);
    await page.getByLabel('Investigation export').setInputFiles({
      name: 'outage-review.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ schema: 'datasnare-rootcause/investigation-v1', events: [] })),
    });
    await page.getByRole('button', { name: 'Import investigation' }).click();
    await page.getByText('Evidence refreshes: 1 · Selected fixture-job').waitFor();
    await page.getByText('Connection pool exhausted').first().waitFor();
    const layout = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: window.innerWidth }));
    assert.ok(layout.width <= layout.viewport + 1, `Workbench overflows at ${viewport.width}px: ${JSON.stringify(layout)}`);
    assert.deepEqual(errors, [], 'The workbench must render without runtime errors');
    console.log(`PASS ${viewport.width}px: JSON import summary renders, evidence refresh runs, no horizontal overflow`);
    await page.close();
  }
} finally {
  await browser?.close();
  await server.close();
}