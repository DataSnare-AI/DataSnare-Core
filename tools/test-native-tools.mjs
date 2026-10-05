import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const tools = process.argv[2] ? [process.argv[2]] : ['aiprocmon', 'aiperf'];
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, open: false } });
const output = await mkdtemp(join(tmpdir(), 'datasnare-native-'));
let browser;
try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  for (const toolId of tools) {
    const label = toolId === 'aiprocmon' ? 'AIProcMon' : 'AIPerf';
    const analyzer = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    analyzer.on('pageerror', error => errors.push(error.message));
    await analyzer.goto(`${origin}${toolId}/index.html?returnTo=%2Faianalysis`);
    await analyzer.getByRole('link', { name: 'Back to AIAnalysis' }).waitFor();
    await analyzer.getByRole('button', { name: 'Load demo' }).click();
    const exportButton = analyzer.getByRole('button', { name: toolId === 'aiprocmon' ? 'Export analysis' : 'Export events JSON', exact: true });
    await exportButton.waitFor();
    const downloadPromise = analyzer.waitForEvent('download');
    await exportButton.click();
    const download = await downloadPromise;
    const exportPath = join(output, `${toolId}.json`);
    await download.saveAs(exportPath);
    const document = JSON.parse(await readFile(exportPath, 'utf8'));
    assert.equal(document.schema, `datasnare-${toolId}/events-v1`);
    assert.ok((document.salientEvents || document.events).length > 0);
    const python = process.env.DATASNARE_TEST_PYTHON || join(root, '.venv', 'Scripts', 'python.exe');
    const verification = spawnSync(python, [join(root, 'tools', 'verify-native-export.py'), toolId, exportPath], { encoding: 'utf8' });
    assert.equal(verification.status, 0, `${verification.stdout}\n${verification.stderr}`);
    console.log(verification.stdout.trim());
    assert.deepEqual(errors, []);
    await analyzer.screenshot({ path: join(output, `${toolId}-full.png`), fullPage: true });
    await analyzer.getByRole('link', { name: 'Back to AIAnalysis' }).click();
    await analyzer.waitForURL('**/aianalysis');
    await analyzer.close();
    console.log(`PASS ${label}: real demo/export and return navigation`);
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      const pageErrors = [];
      page.on('pageerror', error => pageErrors.push(error.message));
      const html = await server.transformIndexHtml('/__native-test', '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/tools/fixtures/native-workbench.jsx"></script></body></html>');
      await page.route('**/__native-test?*', route => route.fulfill({ contentType: 'text/html', body: html }));
      await page.route('**/api/health/readiness', route => route.fulfill({ json: { environment: 'development' } }));
      await page.route(`**/api/tenants/7/tools/${toolId}/jobs`, route => {
        const request = route.request().postDataJSON();
        assert.equal(request.artifact_type, 'json');
        assert.equal(request.capture_date, undefined);
        return route.fulfill({ json: { job: { job_id: 'fixture-job', state: 'queued' } } });
      });
      await page.route(`**/api/tenants/7/tools/${toolId}/jobs/fixture-job/artifact`, route => {
        assert.equal(JSON.parse(route.request().postData()).schema, document.schema);
        return route.fulfill({ json: { job: { job_id: 'fixture-job', state: 'completed', artifact_name: 'analysis.json' },
          analysis: { event_count: 1, events: [{ timestamp: '2026-10-04T12:00:00Z', severity: 'warning', summary: 'Imported finding' }], message: 'Imported export.' } } });
      });
      await page.goto(`${origin}__native-test?tool=${toolId}`);
      const launcher = page.getByRole('link', { name: `Open full ${label}` });
      assert.equal(await launcher.getAttribute('target'), '_blank');
      for (const name of ['Download Windows conversion helper', 'Download conversion instructions']) {
        const pending = page.waitForEvent('download');
        await page.getByRole('link', { name, exact: true }).click();
        const downloaded = await pending;
        const path = join(output, `${toolId}-${width}-${downloaded.suggestedFilename()}`);
        await downloaded.saveAs(path);
        const content = await readFile(path, 'utf8');
        assert.ok(content.length > 500);
        assert.ok(content.includes(name.includes('instructions') ? '## Run' : '[CmdletBinding()]'));
      }
      await page.getByLabel(`${label} analysis JSON`).setInputFiles(exportPath);
      await page.getByRole('button', { name: 'Import analysis', exact: true }).click();
      await page.getByText('Selected evidence: fixture-job').waitFor();
      const layout = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth }));
      assert.ok(layout.width <= layout.viewport + 1, `${label} overflows at ${width}px`);
      assert.deepEqual(pageErrors, []);
      await page.screenshot({ path: join(output, `${toolId}-${width}.png`), fullPage: true });
      await page.close();
      console.log(`PASS ${label} ${width}px: real export upload and selection callback`);
    }
  }
  console.log(`Exports and screenshots: ${output}`);
} finally {
  await browser?.close();
  await server.close();
}