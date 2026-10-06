import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function capture() {
  const buffer = Buffer.alloc(94);
  buffer.writeUInt32LE(0xa1b2c3d4); buffer.writeUInt16LE(2, 4); buffer.writeUInt16LE(4, 6);
  buffer.writeUInt32LE(65535, 16); buffer.writeUInt32LE(1, 20);
  buffer.writeUInt32LE(1700000000, 24); buffer.writeUInt32LE(54, 32); buffer.writeUInt32LE(54, 36);
  const frame = buffer.subarray(40); frame.writeUInt16BE(0x0800, 12); frame[14] = 0x45;
  frame.writeUInt16BE(40, 16); frame[22] = 64; frame[23] = 6;
  frame.set([192, 0, 2, 1], 26); frame.set([192, 0, 2, 2], 30);
  frame.writeUInt16BE(5000, 34); frame.writeUInt16BE(443, 36); frame[46] = 0x50; frame[47] = 2;
  return buffer;
}
const root = fileURLToPath(new URL('../', import.meta.url));
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, open: false } });
const output = await mkdtemp(join(tmpdir(), 'datasnare-sessions-'));
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const url = `${server.resolvedUrls.local[0]}ainetscope/index.html`;
  const pageFor = async width => {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    page.on('dialog', dialog => dialog.accept());
    await page.goto(url);
    return page;
  };
  const save = async (page, name) => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save Session', exact: true }).click();
    const download = await pending; const path = join(output, `${name}.json`);
    await download.saveAs(path);
    return path;
  };
  const restore = async (page, path) => {
    await page.locator('#sessionRestoreInput').setInputFiles(path);
    await page.waitForFunction(() => document.querySelector('#sessionStatus').textContent.startsWith('Restored'));
  };
  for (const width of [1440, 390]) {
    let page = await pageFor(width);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.evaluate(async bytes => {
      const file = new File([new Uint8Array(bytes)], 'original.pcap', { lastModified: 12345 });
      await openFile(file);
      workbenchState.notesCaptureId = '';
      localStorage.setItem(noteStorageKey(), JSON.stringify({ 1: { html: '<b>Saved request</b>' } }));
      localStorage.setItem(frameStateStorageKey(), JSON.stringify({ marks: [1], referenceNumber: 1, timeMode: 'reference' }));
      workbenchState.frameState = null;
      showPacketWorkbench(1);
    }, [...capture()]);
    const standard = await save(page, `standard-${width}`);
    const standardDocument = JSON.parse(await readFile(standard, 'utf8'));
    assert.equal(standardDocument.data.packets[0].rawPreview, undefined);
    await page.close(); page = await pageFor(width);
    await restore(page, standard);
    assert.equal(await page.evaluate(() => packetNote(1)), '<b>Saved request</b>');
    assert.equal(await page.evaluate(() => currentFrameState().referenceNumber), 1);
    assert.equal(await page.evaluate(() => state.captureBuffer), null);
    await page.evaluate(async bytes => {
      await relinkSessionFiles([new File([new Uint8Array(bytes)], 'wrong.pcap', { lastModified: 12345 })]);
    }, [...capture()]);
    assert.match(await page.locator('#toast').textContent(), /matching name/);
    await page.evaluate(async bytes => {
      await relinkSessionFiles([new File([new Uint8Array(bytes)], 'original.pcap', { lastModified: 12345 })]);
    }, [...capture()]);
    assert.ok(await page.evaluate(() => packetCaptureBytes(state.packets[0]).length > 0));
    assert.equal(await page.evaluate(() => packetNote(1)), '<b>Saved request</b>');
    console.log(`PASS ${width}px standard: fresh-session notes/marks/T0, metadata-only restore and verified raw-file relink`);
    await page.close();

    if (width === 1440) {
      page = await pageFor(width);
      await page.evaluate(() => {
        state.packets = Array.from({ length: 3000 }, (_, index) => ({ number: index + 1, timestamp: 1700000000 + index / 1000,
          length: 60, protocol: 'TEST', transport: '', src: 'A', dst: 'B', info: 'session scroll fixture' }));
        state.fileName = 'metadata-test.pcap'; state.captureId = 'saved-position';
        state.baseTime = state.packets[0].timestamp; state.duration = 3;
        showPacketWorkbench(1);
      });
      await page.evaluate(() => { document.querySelector('#workbenchListPane').scrollTop = 20000; });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const positionPath = await save(page, 'saved-position');
      await page.close(); page = await pageFor(width); await restore(page, positionPath);
      await page.waitForFunction(() => document.querySelector('#workbenchListPane').scrollTop > 19000);
      assert.equal(await page.evaluate(() => workbenchState.selectedNumber), 1);
      assert.ok(await page.evaluate(() => Number(document.querySelector('#workbenchRows tr[data-workbench-packet]').dataset.workbenchPacket) > 300));
      await page.close();
      console.log('PASS saved virtual packet position restored independently of offscreen selected frame');
    }

    page = await pageFor(width);
    await page.evaluate(async bytes => {
      const first = new File([new Uint8Array(bytes)], 'first.pcap', { lastModified: 111 });
      const pending = new File([new Uint8Array(bytes)], 'pending.pcap', { lastModified: 222 });
      await analyzeCaptureSet([{ name: first.name, path: first.name, file: first }], 'Saved incident');
      batchState.items.push({ name: pending.name, path: pending.name, file: pending });
      localStorage.setItem(setSummaryStorageKey(), JSON.stringify({ name: 'Saved incident', problemStatement: 'Outage review', narrative: '<b>Set work</b>' }));
      localStorage.setItem(`datasnare-packet-notes:first.pcap:${first.size}:${first.lastModified}`, JSON.stringify({ 1: { html: '<b>Child capture note</b><img src=x onerror="alert(1)">' } }));
    }, [...capture()]);
    const set = await save(page, `set-${width}`);
    await page.close(); page = await pageFor(width); await restore(page, set);
    assert.equal(await page.evaluate(() => batchState.results[0].status), 'Analyzed');
    assert.equal(await page.evaluate(() => batchState.results[1].status), 'Queued');
    assert.equal(await page.evaluate(() => captureSetSummary().problemStatement), 'Outage review');
    await page.evaluate(() => openSetCapture(0));
    assert.match(await page.locator('#toast').textContent(), /Relink/);
    await page.evaluate(async bytes => {
      await relinkSessionFiles([new File([new Uint8Array(bytes)], 'first.pcap', { lastModified: 111 }),
        new File([new Uint8Array(bytes)], 'pending.pcap', { lastModified: 222 })]);
    }, [...capture()]);
    await page.getByRole('button', { name: 'Resume pending set files', exact: true }).click();
    await page.waitForFunction(() => !batchState.running && batchState.results.every(result => result.status === 'Analyzed'));
    assert.equal(await page.evaluate(() => batchState.results.length), 2);
    assert.equal(await page.evaluate(() => captureSetSummary().problemStatement), 'Outage review');
    const popupPromise = page.waitForEvent('popup');
    await page.locator('#setFileRows tr').first().click();
    const child = await popupPromise;
    await child.waitForFunction(() => window.DataSnareAINetScope?.summary.packets === 1);
    assert.equal(await child.evaluate(() => packetNote(1)), '<b>Child capture note</b>');
    await child.close();
    console.log(`PASS ${width}px set: completed results restored, originals relinked, pending analysis resumed without duplicates`);
    await page.close();

    page = await pageFor(width);
    await page.locator('#sessionRestoreInput').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"schema":"bad"}') });
    await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('Session restore failed'));
    assert.equal(await page.evaluate(() => state.packets.length), 0);
    assert.equal(await page.evaluate(() => batchState.items.length), 0);
    const layout = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(layout.width <= layout.viewport + 1);
    await page.screenshot({ path: join(output, `session-toolbar-${width}.png`), fullPage: true });
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(`Session fixtures: ${output}`);
} finally { await browser?.close(); await server.close(); }