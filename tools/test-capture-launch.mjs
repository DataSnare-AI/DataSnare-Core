import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function capture() {
  const buffer = Buffer.alloc(24 + 16 + 54);
  buffer.writeUInt32LE(0xa1b2c3d4); buffer.writeUInt16LE(2, 4); buffer.writeUInt16LE(4, 6);
  buffer.writeUInt32LE(65535, 16); buffer.writeUInt32LE(1, 20);
  buffer.writeUInt32LE(1700000000, 24); buffer.writeUInt32LE(54, 32); buffer.writeUInt32LE(54, 36);
  const frame = buffer.subarray(40);
  frame.writeUInt16BE(0x0800, 12); frame[14] = 0x45; frame.writeUInt16BE(40, 16);
  frame[22] = 64; frame[23] = 6; frame.set([192, 0, 2, 1], 26); frame.set([192, 0, 2, 2], 30);
  frame.writeUInt16BE(5000, 34); frame.writeUInt16BE(443, 36); frame[46] = 0x50; frame[47] = 2;
  return buffer;
}

const root = fileURLToPath(new URL('../', import.meta.url));
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, open: false } });
const screenshots = await mkdtemp(join(tmpdir(), 'datasnare-launch-'));
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${server.resolvedUrls.local[0]}ainetscope/index.html`);
    await page.evaluate(bytes => {
      const file = new File([new Uint8Array(bytes)], 'set-capture.pcap');
      batchState.results = [{ index: 0, name: file.name, path: file.name, status: 'Analyzed', source: file }];
    }, [...capture()]);
    await page.getByRole('button', { name: 'Open packet workbench', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    const childPromise = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'set-capture.pcap', exact: true }).click();
    const child = await childPromise;
    const childErrors = [];
    child.on('pageerror', error => childErrors.push(error.message));
    await child.waitForFunction(() => window.DataSnareAINetScope?.summary.packets === 1);
    assert.match(await child.title(), /set-capture.pcap/);
    assert.equal(await child.evaluate(() => window.opener), null);
    assert.equal(await page.evaluate(() => state.packets.length), 0);
    assert.equal(await page.evaluate(() => batchState.results.length), 1);
    await child.close();
    await page.locator('#openCaptureButton').click();
    const newChildPromise = page.waitForEvent('popup');
    const pickerPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'New File', exact: true }).click();
    const newChild = await newChildPromise;
    const picker = await pickerPromise;
    await picker.setFiles({ name: 'new-capture.pcap', mimeType: 'application/octet-stream', buffer: capture() });
    await newChild.waitForFunction(() => window.DataSnareAINetScope?.summary.packets === 1);
    assert.match(await newChild.title(), /new-capture.pcap/);
    assert.equal(await page.evaluate(() => state.packets.length), 0);
    await newChild.close();
    await page.evaluate(() => { batchState.results = []; batchState.items = []; });
    const standalonePopup = page.waitForEvent('popup');
    const standalonePicker = page.waitForEvent('filechooser');
    await page.locator('#openCaptureButton').click();
    const standalone = await standalonePopup;
    await (await standalonePicker).setFiles({ name: 'standalone.pcap', mimeType: 'application/octet-stream', buffer: capture() });
    await standalone.waitForFunction(() => window.DataSnareAINetScope?.summary.packets === 1);
    await standalone.close();
    await page.evaluate(bytes => {
      const file = new File([new Uint8Array(bytes)], 'set-capture.pcap');
      batchState.results = [{ index: 0, name: file.name, path: file.name, status: 'Analyzed', source: file }];
    }, [...capture()]);
    const clickedChildPromise = page.waitForEvent('popup');
    await page.evaluate(() => openSetCapture(0));
    const clickedChild = await clickedChildPromise;
    await clickedChild.waitForFunction(() => window.DataSnareAINetScope?.summary.packets === 1);
    await clickedChild.close();
    await page.evaluate(() => {
      const original = window.open;
      window.open = () => null;
      openSetCapture(0);
      window.open = original;
    });
    assert.match(await page.locator('#toast').textContent(), /blocked/);
    await page.getByRole('button', { name: 'Analyze a capture set', exact: true }).click();
    await page.locator('#setDemoButton').click();
    await page.waitForFunction(() => batchState.results.length === 12 && batchState.results.every(result => result.status === 'Analyzed'));
    const demoPopupPromise = page.waitForEvent('popup');
    await page.locator('#setFileRows tr[data-set-index]').first().click();
    const demoChild = await demoPopupPromise;
    await demoChild.waitForFunction(() => (window.DataSnareAINetScope?.summary.packets || 0) > 0);
    assert.equal(await page.locator('#setWorkspace').isVisible(), true);
    assert.equal(await page.evaluate(() => batchState.results.length), 12);
    await demoChild.close();
    await page.locator('#openCaptureButton').click();
    const canceledPopupPromise = page.waitForEvent('popup');
    const canceledPickerPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'New File', exact: true }).click();
    const canceledChild = await canceledPopupPromise;
    await canceledPickerPromise;
    const closed = canceledChild.waitForEvent('close');
    await page.locator('#captureInput').dispatchEvent('cancel');
    await closed;
    assert.equal(await page.evaluate(() => capturePickerLaunch), null);
    await page.screenshot({ path: join(screenshots, `toolbar-${width}.png`), fullPage: true });
    const layout = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(layout.width <= layout.viewport + 1, `Toolbar overflow: ${JSON.stringify(layout)}`);
    assert.deepEqual(errors, []);
    assert.deepEqual(childErrors, []);
    console.log(`PASS ${width}px: set chooser, new File handoff, direct set launch, parent isolation and popup-block feedback`);
    await page.close();
  }
  console.log(`Screenshots: ${screenshots}`);
} finally {
  await browser?.close();
  await server.close();
}