import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

function pcap(rows) {
  const header = Buffer.alloc(24);
  header.writeUInt32LE(0xa1b2c3d4); header.writeUInt16LE(2, 4); header.writeUInt16LE(4, 6);
  header.writeUInt32LE(65535, 16); header.writeUInt32LE(1, 20);
  const frames = rows.map(row => {
    const frame = Buffer.alloc(55);
    frame.writeUInt16BE(0x0800, 12); frame[14] = 0x45; frame.writeUInt16BE(41, 16);
    frame[22] = 64; frame[23] = 6;
    row.src.split('.').forEach((value, index) => frame[26 + index] = Number(value));
    row.dst.split('.').forEach((value, index) => frame[30 + index] = Number(value));
    frame.writeUInt16BE(row.srcPort, 34); frame.writeUInt16BE(row.dstPort, 36);
    frame.writeUInt32BE(row.seq, 38); frame.writeUInt32BE(row.ack, 42);
    frame[46] = 0x50; frame[47] = 0x18; frame.writeUInt16BE(65535, 48); frame[54] = 65;
    const entry = Buffer.alloc(16);
    entry.writeUInt32LE(Math.floor(row.time), 0); entry.writeUInt32LE(Math.round((row.time % 1) * 1e6), 4);
    entry.writeUInt32LE(frame.length, 8); entry.writeUInt32LE(frame.length, 12);
    return Buffer.concat([entry, frame]);
  });
  return Buffer.concat([header, ...frames]);
}

const root = fileURLToPath(new URL('../', import.meta.url));
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, open: false } });
const output = await mkdtemp(join(tmpdir(), 'datasnare-two-sided-'));
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  for (const width of [3200, 1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, timezoneId: 'America/New_York' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${server.resolvedUrls.local[0]}ainetscope/index.html`);
    await page.getByRole('button', { name: 'Two-Sided', exact: true }).click();
    const request = { src: '10.0.0.1', dst: '10.0.0.2', srcPort: 5000, dstPort: 443, seq: 1001, ack: 3405 };
    const reply = { src: '10.0.0.2', dst: '10.0.0.1', srcPort: 443, dstPort: 5000, seq: 3405, ack: 1002 };
    await page.getByLabel('System A capture', { exact: true }).setInputFiles({ name: 'system-a.pcap', mimeType: 'application/octet-stream',
      buffer: pcap([{ ...request, time: 100 }, { ...reply, time: 100.205 }]) });
    await page.getByLabel('System B capture', { exact: true }).setInputFiles({ name: 'system-b.pcap', mimeType: 'application/octet-stream',
      buffer: pcap([{ ...request, time: 100.105 }, { ...request, dst: '10.0.0.3', seq: 50, time: 100.12 },
        { ...reply, time: 100.3 }]) });
    await page.getByLabel('Add to System B clock (ms)', { exact: true }).fill('-100');
    await page.getByLabel('System A local IP', { exact: true }).fill('10.0.0.1');
    await page.getByLabel('System B local IP', { exact: true }).fill('10.0.0.2');
    await page.getByRole('button', { name: 'Analyze two traces', exact: true }).click();
    await page.waitForFunction(() => window.DataSnareTwoSided.records.length === 3);
    const records = await page.evaluate(() => window.DataSnareTwoSided.records.map(record => ({
      status: record.status, frameA: record.packetA?.number, frameB: record.packetB?.number,
      transit: record.transitMs, direction: record.direction,
    })));
    const utcToggle = page.getByRole('checkbox', { name: 'Show UTC time', exact: true });
    assert.equal(await utcToggle.isChecked(), false);
    const timestamp = page.locator('.two-sided-packet-line--A time').first();
    assert.equal(await timestamp.textContent(), '1969-12-31 19:01:40.000');
    assert.match(await page.locator('.two-sided-column-side > span:nth-child(3)').first().textContent(), /America\/New_York/);
    await utcToggle.check();
    assert.equal(await timestamp.textContent(), '1970-01-01T00:01:40.000Z');
    assert.equal(await page.locator('.two-sided-packet-line--B time').first().textContent(), '1970-01-01T00:01:40.005Z');
    assert.deepEqual(await page.evaluate(() => window.DataSnareTwoSided.records.map(record => ({
      status: record.status, frameA: record.packetA?.number, frameB: record.packetB?.number,
      transit: record.transitMs, direction: record.direction,
    }))), records);
    await utcToggle.uncheck();
    assert.equal(await timestamp.textContent(), '1969-12-31 19:01:40.000');
    assert.equal(records.filter(record => record.status === 'matched').length, 2);
    assert.ok(records.filter(record => record.status === 'matched').every(record => Math.abs(record.transit - 5) < .001));
    assert.equal(records.find(record => record.direction === 'B to A').frameB, 3);
    await page.getByRole('button', { name: 'Analytics / Expert', exact: true }).click();
    await page.getByRole('dialog', { name: 'Two-Sided Analytics', exact: true }).waitFor();
    await page.locator('.two-analytics-help summary').click();
    assert.match(await page.locator('.two-analytics-help').textContent(), /population standard deviation/i);
    assert.match(await page.locator('.two-analytics-help').textContent(), /Handshake not captured/i);
    await page.locator('.two-analytics-help summary').click();
    assert.deepEqual(await page.locator('#twoSidedAnalyticsBody h3').allTextContents(),
      ['Path Performance', 'Loss Diagnostics', 'Middlebox Impact', 'Flow Control', 'Supporting Findings']);
    const snapshot = await page.evaluate(() => twoSidedAnalyticsSnapshot);
    assert.equal(snapshot.metrics.directions[0].p95.toFixed(3), '5.000');
    assert.equal(snapshot.metrics.directions[1].p99.toFixed(3), '5.000');
    assert.equal(snapshot.metrics.loss.onlyB, 1);
    assert.equal(snapshot.metrics.flowA.flight.count, 0);
    const pendingExport = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export findings JSON', exact: true }).click();
    const downloaded = await pendingExport;
    const exportPath = join(output, `two-sided-findings-${width}.json`);
    await downloaded.saveAs(exportPath);
    const exported = JSON.parse(await readFile(exportPath, 'utf8'));
    assert.equal(exported.scope.bOffsetMs, -100);
    assert.equal(exported.scope.pagination, 'all_filtered_observations');
    assert.equal(exported.schema, 'datasnare-ainetscope/two-sided-findings-v1');
    const python = process.env.DATASNARE_TEST_PYTHON || join(root, '.venv', 'Scripts', 'python.exe');
    const imported = spawnSync(python, [join(root, 'tools', 'verify-native-export.py'), 'ainetscope', exportPath], { encoding: 'utf8' });
    assert.equal(imported.status, 0, `${imported.stdout}\n${imported.stderr}`);
    const context = vm.createContext({ crypto: globalThis.crypto });
    vm.runInContext(`${await readFile(join(root, '..', 'DataSnare-AIRootCause', 'plugins.js'), 'utf8')}\nglobalThis.adapters = DataSnarePlugins;`, context);
    const rootcause = await context.adapters.parseFile({ name: 'two-sided.json', text: async () => JSON.stringify(exported) });
    assert.equal(rootcause.adapter, 'ainetscope-two-sided');
    assert.equal(rootcause.analytics.scope.bOffsetMs, -100);
    assert.ok(rootcause.analytics.untimedFindings.length >= 2);
    assert.ok(rootcause.events.every(item => Number.isFinite(item.timestamp)));
    assert.equal(rootcause.events[0].evidence.frameA, 1);
    if (width === 1440) {
      const rcaPage = await browser.newPage();
      const rcaErrors = [];
      rcaPage.on('pageerror', error => rcaErrors.push(error.message));
      await rcaPage.route('**/__rootcause/*', async route => {
        const asset = new URL(route.request().url()).pathname.split('/').at(-1);
        if (!['index.html', 'app.js', 'plugins.js', 'styles.css'].includes(asset)) return route.abort();
        const body = await readFile(join(root, '..', 'DataSnare-AIRootCause', asset));
        return route.fulfill({ body, contentType: asset.endsWith('.js') ? 'text/javascript' : asset.endsWith('.css') ? 'text/css' : 'text/html' });
      });
      await rcaPage.goto(`${server.resolvedUrls.local[0]}__rootcause/index.html`);
      await rcaPage.locator('#artifactInput').setInputFiles(exportPath);
      await rcaPage.waitForFunction(() => window.DataSnareAIRootCause.export().sources.length === 1);
      const investigation = await rcaPage.evaluate(() => window.DataSnareAIRootCause.export());
      assert.equal(investigation.sources[0].analytics.scope.bOffsetMs, -100);
      assert.ok(investigation.sources[0].analytics.untimedFindings.length > 0);
      assert.equal(investigation.events[0].evidence.frameB, 1);
      assert.equal(await rcaPage.locator('.source-analytics summary').textContent(), 'Two-Sided analytics context');
      assert.match(await rcaPage.locator('.source-analytics').textContent(), /Confirmed drop location unavailable/);
      assert.deepEqual(rcaErrors, []);
      await rcaPage.close();
    }
    await page.screenshot({ path: join(output, `analytics-${width}.png`), fullPage: true });
    await page.locator('[data-analytics-finding="0"]').click();
    assert.equal(await page.locator('#twoSidedAnalyticsDialog').isVisible(), false);
    assert.equal(await page.locator('.two-sided-row--selected').count(), 1);
    const select = page.getByLabel('Connection', { exact: true });
    await select.selectOption('10.0.0.1:5000 <-> 10.0.0.2:443');
    assert.equal(await page.locator('.two-sided-row--context').count(), 1);
    await page.getByLabel('Include other connection context', { exact: true }).uncheck();
    assert.equal(await page.locator('.two-sided-row').count(), 2);
    await page.getByRole('button', { name: 'Inspect System A frame 1', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    assert.ok((await page.locator('#twoSidedDetail').textContent()).includes('System B / frame 1'));
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    assert.equal(await page.locator('.two-sided-columns').count(), 1);
    if (width === 3200) {
      assert.ok(await page.locator('#twoSidedScroll').evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'Both packet lists should fit on a wide desktop');
    }
    const initialDelta = await page.locator('.two-sided-packet-line--B .two-sided-packet').nth(1).locator(':scope > span').nth(1).textContent();
    assert.equal(initialDelta, '180.000');
    const pairIntervals = await page.evaluate(() => twoSidedState.records.map(record => record.transitMs));
    await page.getByRole('button', { name: 'Inspect System A frame 1', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Mark Frame / System A', exact: true }).click();
    assert.equal(await page.locator('.two-sided-packet-line--A[data-two-frame="1"].marked').count(), 1);
    assert.equal(await page.locator('.two-sided-packet-line--B[data-two-frame="1"].marked').count(), 0);
    await page.getByRole('button', { name: 'Inspect System A frame 1', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Set as Time Reference / System A', exact: true }).click();
    assert.equal(await page.locator('.two-sided-packet-line--A[data-two-frame="1"] .mark-indicator').textContent(), 'T0');
    assert.equal(await page.locator('.two-sided-packet-line--A[data-two-frame="2"] .two-sided-packet > span').nth(1).textContent(), '205.000');
    await page.getByRole('button', { name: 'Inspect System B frame 3', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Set as Time Reference / System B', exact: true }).click();
    assert.equal(await page.locator('.two-sided-packet-line--B[data-two-frame="1"] .two-sided-packet > span').nth(1).textContent(), '-195.000');
    assert.deepEqual(await page.evaluate(() => twoSidedState.records.map(record => record.transitMs)), pairIntervals);
    await page.getByRole('button', { name: 'Inspect System B frame 3', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Clear Time Reference / System B', exact: true }).click();
    await page.getByRole('button', { name: 'Inspect System A frame 1', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Unmark Frame / System A', exact: true }).click();
    assert.equal(await page.locator('.two-sided-packet-line--A.time-reference').count(), 0);
    await page.getByRole('button', { name: 'Inspect System A frame 1', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Add Note / System A', exact: true }).click();
    await page.getByLabel('Note', { exact: true }).fill('A request note <safe>');
    await page.getByRole('button', { name: 'Save note', exact: true }).click();
    await page.getByRole('button', { name: 'Add System B frame 1 note', exact: true }).click();
    await page.getByLabel('Note', { exact: true }).fill('B receive note');
    await page.getByRole('button', { name: 'Save note', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Edit System A frame 1 note', exact: true }).getAttribute('title'), 'A request note <safe>');
    assert.equal(await page.getByRole('button', { name: 'Edit System B frame 1 note', exact: true }).getAttribute('title'), 'B receive note');
    await page.evaluate(() => {
      const file = document.querySelector('#twoSidedFileB').files[0];
      twoSidedAnnotations.notes.B = {};
      prepareTwoSidedAnnotations('B', file, twoSidedState.packetsB);
      renderTwoSided();
    });
    assert.equal(await page.getByRole('button', { name: 'Edit System B frame 1 note', exact: true }).getAttribute('title'), 'B receive note');
    assert.deepEqual(errors, []);
    await page.evaluate(() => { document.querySelector('#twoSidedScroll').scrollLeft = 0; });
    await page.screenshot({ path: join(output, `two-sided-${width}.png`), fullPage: true });
    await page.getByLabel('Add to System B clock (ms)', { exact: true }).fill('-90');
    await page.getByRole('button', { name: 'Analyze two traces', exact: true }).click();
    await page.waitForFunction(() => window.DataSnareTwoSided.records.some(record => record.direction === 'A to B' && Math.abs(record.transitMs - 15) < .001));
    await page.getByRole('button', { name: 'Edit System A frame 1 note', exact: true }).click();
    assert.equal(await page.getByLabel('Note', { exact: true }).inputValue(), 'A request note <safe>');
    await page.getByRole('button', { name: 'Delete note', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Add System A frame 1 note', exact: true }).count(), 1);
    assert.equal(await page.getByRole('button', { name: 'Edit System B frame 1 note', exact: true }).count(), 1);
    assert.equal(await page.locator('.two-sided-packet-line--B[data-two-frame="3"].marked').count(), 1);
    const sessionDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save Session', exact: true }).click();
    const downloadedSession = await sessionDownload;
    const sessionPath = join(output, `two-sided-session-${width}.json`);
    await downloadedSession.saveAs(sessionPath);
    const fresh = await browser.newPage({ viewport: { width, height: 1000 } });
    fresh.on('dialog', dialog => dialog.accept());
    await fresh.goto(`${server.resolvedUrls.local[0]}ainetscope/index.html`);
    await fresh.locator('#sessionRestoreInput').setInputFiles(sessionPath);
    await fresh.waitForFunction(() => document.querySelector('#sessionStatus').textContent.startsWith('Restored'));
    assert.equal(await fresh.evaluate(() => twoSidedState.offsetMs), -90);
    assert.equal(await fresh.evaluate(() => twoSidedNote('B', 1)), 'B receive note');
    assert.ok(await fresh.evaluate(() => twoSidedFrameStates.B.marks.includes(3)));
    assert.equal(await fresh.evaluate(() => twoSidedState.records.filter(record => record.status === 'matched').length), 2);
    await fresh.getByRole('button', { name: 'Analytics / Expert', exact: true }).click();
    assert.equal(await fresh.evaluate(() => twoSidedAnalyticsSnapshot.scope.bOffsetMs), -90);
    await fresh.getByRole('button', { name: 'Close analytics', exact: true }).click();
    const savedSession = JSON.parse(await readFile(sessionPath, 'utf8'));
    await page.getByRole('checkbox', { name: 'Two-Sided save: matched pairs only', exact: true }).check();
    const reducedDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save Session', exact: true }).click();
    const reducedPath = join(output, `matched-only-session-${width}.json`);
    await (await reducedDownload).saveAs(reducedPath);
    const reducedText = await readFile(reducedPath, 'utf8');
    const reduced = JSON.parse(reducedText);
    assert.ok(reducedText.length < (await readFile(sessionPath, 'utf8')).length);
    assert.equal(reduced.data.sessionCoverage, 'matched_pairs_only');
    assert.deepEqual(reduced.data.packetsB.map(packet => packet.number), [1, 3]);
    await fresh.locator('#sessionRestoreInput').setInputFiles(reducedPath);
    await fresh.waitForFunction(() => twoSidedState.sessionCoverage === 'matched_pairs_only');
    assert.equal(await fresh.evaluate(() => twoSidedAnnotations.deltas.B.get(3).toFixed(3)), '180.000');
    await fresh.getByRole('button', { name: 'Analytics / Expert', exact: true }).click();
    assert.equal(await fresh.evaluate(() => twoSidedAnalyticsSnapshot.scope.sessionCoverage), 'matched_pairs_only');
    assert.equal(await fresh.evaluate(() => twoSidedAnalyticsSnapshot.metrics.loss.onlyA), null);
    assert.equal(await fresh.evaluate(() => twoSidedAnalyticsSnapshot.metrics.flowA.flight.max), null);
    assert.match(await fresh.locator('#twoSidedAnalyticsBody').textContent(), /Reduced session/);
    await fresh.getByRole('button', { name: 'Close analytics', exact: true }).click();
    const relinkBytes = [
      [...pcap([{ ...request, time: 100 }, { ...reply, time: 100.205 }])],
      [...pcap([{ ...request, time: 100.105 }, { ...request, dst: '10.0.0.3', seq: 50, time: 100.12 }, { ...reply, time: 100.3 }])],
    ];
    await fresh.evaluate(async ({ metadata, bytes }) => {
      await relinkSessionFiles(metadata.map((item, index) => new File([new Uint8Array(bytes[index])], item.name, { lastModified: item.lastModified })));
    }, { metadata: savedSession.data.context.sources, bytes: relinkBytes });
    assert.match(await fresh.locator('#sessionStatus').textContent(), /Both original captures relinked/);
    assert.equal(await fresh.evaluate(() => twoSidedState.sessionCoverage), 'full_metadata');
    assert.equal(await fresh.evaluate(() => twoSidedState.packetsB.length), 3);
    assert.equal(await fresh.evaluate(() => twoSidedNote('B', 1)), 'B receive note');
    assert.ok(await fresh.evaluate(() => twoSidedFrameStates.B.marks.includes(3)));
    await fresh.close();
    assert.ok(await page.evaluate(() => window.DataSnareTwoSided.records.some(record => record.direction === 'B to A' && record.transitMs < 0)));
    await page.evaluate(() => {
      const match = twoSidedState.records.find(record => record.status === 'matched');
      twoSidedState.records = [...Array.from({ length: 450 }, (_, index) => ({ ...match,
        status: 'unmatched', packetB: null, deltaMs: null, transitMs: null,
        packetA: { ...match.packetA, number: index + 1000 } })), match];
      twoSidedState.page = 0;
      document.querySelector('#twoSidedConnection').value = 'all';
      document.querySelector('#twoSidedSearch').value = '';
      renderTwoSided();
    });
    await page.getByRole('button', { name: 'Jump to First Matched Pair', exact: true }).click();
    assert.match(await page.locator('#twoSidedPage').textContent(), /page 4 of 4/);
    await page.getByRole('button', { name: 'Analytics / Expert', exact: true }).click();
    assert.equal(await page.evaluate(() => twoSidedAnalyticsSnapshot.metrics.total), 451);
    assert.equal(await page.evaluate(() => twoSidedAnalyticsSnapshot.metrics.matched), 1);
    await page.getByRole('button', { name: 'Close analytics', exact: true }).click();
    assert.equal(await page.locator('.two-sided-row--selected.two-sided-row--matched').count(), 1);
    assert.deepEqual(await page.locator('#twoSidedWorkspace > .two-sided-toolbar > button').evaluateAll(buttons => buttons.map(button => button.id)),
      ['twoSidedFirstMatch', 'twoSidedMatchedOnly', 'twoSidedPrevious', 'twoSidedNext', 'twoSidedAnalyticsButton']);
    await page.getByRole('button', { name: 'Show Matched Only', exact: true }).click();
    assert.equal(await page.locator('.two-sided-row').count(), 1);
    assert.equal(await page.locator('.two-sided-row--matched').count(), 1);
    assert.match(await page.locator('#twoSidedPage').textContent(), /page 1 of 1/);
    await page.getByRole('button', { name: 'Analytics / Expert', exact: true }).click();
    assert.equal(await page.evaluate(() => twoSidedAnalyticsSnapshot.metrics.total), 1);
    assert.equal(await page.evaluate(() => twoSidedAnalyticsSnapshot.metrics.loss.onlyA), 0);
    await page.getByRole('button', { name: 'Close analytics', exact: true }).click();
    await page.getByRole('button', { name: 'Show All Observations', exact: true }).click();
    await page.getByRole('button', { name: 'Capture capacity settings', exact: true }).click();
    await page.getByLabel('Two-Sided rows per page', { exact: true }).fill('50');
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    assert.equal(await page.locator('.two-sided-row').count(), 50);
    assert.match(await page.locator('#twoSidedPage').textContent(), /page 1 of 10/);
    await page.getByRole('button', { name: 'Jump to First Matched Pair', exact: true }).click();
    assert.match(await page.locator('#twoSidedPage').textContent(), /page 10 of 10/);
    assert.equal(await page.locator('.two-sided-row--selected.two-sided-row--matched').count(), 1);
    await page.getByLabel('Find frames or endpoints', { exact: true }).fill('unmatched');
    assert.equal(await page.getByRole('button', { name: 'Jump to First Matched Pair', exact: true }).isDisabled(), true);
    await page.getByLabel('Find frames or endpoints', { exact: true }).fill('');
    await page.evaluate(() => {
      const sample = twoSidedState.records[0];
      twoSidedState.records.push({ ...sample, status: 'ambiguous' });
      renderTwoSided();
    });
    await page.getByRole('button', { name: 'Show Matched Only', exact: true }).click();
    await page.getByRole('combobox', { name: 'Observation status', exact: true }).selectOption('ambiguous');
    assert.equal(await page.locator('.two-sided-row').count(), 1);
    assert.equal(await page.locator('.two-sided-row--ambiguous').count(), 1);
    assert.equal(await page.getByRole('button', { name: 'Show Matched Only', exact: true }).getAttribute('aria-pressed'), 'false');
    await page.getByRole('combobox', { name: 'Observation status', exact: true }).selectOption('all');
    await page.evaluate(() => {
      const sample = twoSidedState.records.find(record => record.status === 'matched');
      const flags = [['SYN'], ['SYN', 'ACK'], ['FIN'], ['FIN', 'ACK'], ['RST', 'ACK', 'SYN']];
      twoSidedState.records = flags.map((packetFlags, index) => ({ ...sample,
        status: index === 4 ? 'ambiguous' : 'matched',
        packetA: { ...sample.packetA, number: 9000 + index, flags: packetFlags, tcpFlagsValue: [2, 18, 1, 17, 22][index] },
        packetB: null,
      }));
      twoSidedFrameStates.A.marks.push(9004);
      twoSidedState.page = 0;
      renderTwoSided();
    });
    const colors = await page.locator('.two-sided-flags').evaluateAll(elements => elements.map(element => ({
      className: element.className, color: getComputedStyle(element).color,
    })));
    assert.deepEqual(colors.map(item => item.className.split('--')[1]), ['syn', 'syn-ack', 'fin', 'fin-ack', 'rst']);
    assert.equal(new Set(colors.map(item => item.color)).size, 5);
    assert.equal(colors[4].color, 'rgb(180, 35, 24)');
    const rowSizes = await page.locator('.two-sided-packet-line').evaluateAll(lines => lines.map(line => ({ height: line.getBoundingClientRect().height,
      cells: [...line.querySelector('.two-sided-packet').children].map(cell => ({ height: cell.getBoundingClientRect().height, text: cell.textContent, display: getComputedStyle(cell).display })) })));
    assert.ok(rowSizes.every(line => line.height <= 40), `Signal and mark styling should keep packet lines compact: ${JSON.stringify(rowSizes)}`);
    await page.evaluate(() => {
      const packet = twoSidedState.records[0].packetA;
      packet.number = 1727999;
      packet.src = '2001:0db8:1234:5678:90ab:cdef:1234:5678';
      twoSidedFrameStates.A.referenceNumber = packet.number;
      renderTwoSided();
    });
    const clipped = await page.locator('.two-sided-packet-line--A .two-sided-packet').first().evaluate(element =>
      [...element.children].slice(0, 5).filter(cell => cell.scrollWidth > cell.clientWidth + 1).map(cell => cell.textContent));
    assert.deepEqual(clipped, [], 'Frame number with T0, timestamp, delta and IP columns should show their full values');
    assert.equal(await page.locator('.two-sided-row--ambiguous .two-sided-packet-line.marked').count(), 1);
    assert.equal(await page.locator('.two-sided-row--ambiguous .two-sided-link').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(255, 235, 186)');
    await page.evaluate(() => { document.querySelector('#twoSidedScroll').scrollLeft = 0; });
    await page.screenshot({ path: join(output, `two-sided-signals-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Back to capture', exact: true }).click();
    assert.equal(await page.locator('#twoSidedWorkspace').isVisible(), false);
    await page.reload();
    await page.getByRole('button', { name: 'Capture capacity settings', exact: true }).click();
    assert.equal(await page.getByLabel('Two-Sided rows per page', { exact: true }).inputValue(), '50');
    assert.deepEqual(errors, []);
    console.log(`PASS Two-Sided ${width}px: 2 real captures, offset, both directions, downstream context and linked inspection`);
    await page.close();
  }
  console.log(`Screenshots: ${output}`);
} finally {
  await browser?.close();
  await server.close();
}