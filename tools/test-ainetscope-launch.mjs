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

  const analyzer = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const analyzerErrors = [];
  const failedResources = [];
  analyzer.on('pageerror', error => analyzerErrors.push(error.message));
  analyzer.on('response', response => { if (response.status() >= 400) failedResources.push({ status: response.status(), url: response.url() }); });
  await analyzer.goto(`${origin}ainetscope/index.html?returnTo=%2Faianalysis`);
  await analyzer.getByRole('link', { name: 'Back to AIAnalysis' }).waitFor({ timeout: 3000 }).catch(async () => {
    console.log(JSON.stringify({ url: analyzer.url(), title: await analyzer.title(), linkCount: await analyzer.locator('#coreReturnLink').count(), errors: analyzerErrors }));
    throw new Error('AINetScope return link did not become visible');
  });
  await analyzer.getByRole('button', { name: 'Load demo' }).click();
  await analyzer.waitForFunction(() => !document.querySelector('#dashboard').hidden);
  assert.ok(Number(await analyzer.locator('#kpiPackets').textContent()) > 0, 'Full AINetScope demo should load packets');
  assert.deepEqual(analyzerErrors, [], 'Full analyzer should load without JavaScript runtime errors');
  assert.deepEqual(failedResources, [], 'The analyzer should not have failed HTTP asset requests');
  await analyzer.getByRole('link', { name: 'Back to AIAnalysis' }).click();
  await analyzer.waitForURL('**/aianalysis');
  console.log('PASS full analyzer: static app opens, demo trace loads, AIAnalysis return link works');
  await analyzer.close();

  const html = await server.transformIndexHtml('/__ainetscope-regression', '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/tools/fixtures/ainetscope-workbench.jsx"></script></body></html>');
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/__ainetscope-regression', route => route.fulfill({ contentType: 'text/html', body: html }));
    await page.route('**/api/health/readiness', route => route.fulfill({ json: { environment: 'development' } }));
    await page.route('**/api/tenants/7/tools/ainetscope/jobs', route => route.fulfill({ json: {
      schema: 'datasnare-ainetscope/job-v1',
      job: { job_id: 'import-job', artifact_name: 'capture-analysis.json', state: 'queued' },
    } }));
    await page.route('**/api/tenants/7/tools/ainetscope/jobs/import-job/artifact', route => route.fulfill({ json: {
      job: { job_id: 'import-job', artifact_name: 'capture-analysis.json', state: 'completed' },
      analysis: { event_count: 2, packets: 840, message: 'Imported 2 events.', preview: [{ category: 'network.finding', severity: 'critical', summary: 'TCP sessions reset' }] },
    } }));
    await page.goto(`${origin}__ainetscope-regression`);
    const fullLink = page.getByRole('link', { name: 'Open full AINetScope' });
    assert.equal(await fullLink.getAttribute('target'), '_blank');
    assert.match(await fullLink.getAttribute('href'), /^\/ainetscope\/index\.html/);
    await page.getByLabel('AINetScope analysis JSON').setInputFiles({
      name: 'capture-analysis.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ schema: 'datasnare-ainetscope/analysis-v1' })),
    });
    await page.getByRole('button', { name: 'Import analysis' }).click();
    await page.getByText('Selected evidence job: import-job').waitFor();
    await page.getByText('TCP sessions reset').waitFor();
    const layout = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: window.innerWidth }));
    assert.ok(layout.width <= layout.viewport + 1, `AINetScope workbench overflows at ${viewport.width}px: ${JSON.stringify(layout)}`);
    assert.deepEqual(errors, [], 'AINetScope workbench should render without runtime errors');
    console.log(`PASS ${viewport.width}px workbench: opens full tool, imports export, selects tenant evidence without overflow`);
    await page.close();
  }
} finally {
  await browser?.close();
  await server.close();
}