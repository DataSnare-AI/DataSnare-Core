import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
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
    assert.equal(records.filter(record => record.status === 'matched').length, 2);
    assert.ok(records.filter(record => record.status === 'matched').every(record => Math.abs(record.transit - 5) < .001));
    assert.equal(records.find(record => record.direction === 'B to A').frameB, 3);
    const select = page.getByLabel('Connection', { exact: true });
    await select.selectOption('10.0.0.1:5000 <-> 10.0.0.2:443');
    assert.equal(await page.locator('.two-sided-row--context').count(), 1);
    await page.getByLabel('Include other connection context', { exact: true }).uncheck();
    assert.equal(await page.locator('.two-sided-row').count(), 2);
    await page.getByRole('button', { name: 'Inspect System A frame 1', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    assert.ok((await page.locator('#twoSidedDetail').textContent()).includes('System B / frame 1'));
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    assert.deepEqual(errors, []);
    await page.screenshot({ path: join(output, `two-sided-${width}.png`), fullPage: true });
    await page.getByLabel('Add to System B clock (ms)', { exact: true }).fill('-90');
    await page.getByRole('button', { name: 'Analyze two traces', exact: true }).click();
    await page.waitForFunction(() => window.DataSnareTwoSided.records.some(record => record.direction === 'A to B' && Math.abs(record.transitMs - 15) < .001));
    assert.ok(await page.evaluate(() => window.DataSnareTwoSided.records.some(record => record.direction === 'B to A' && record.transitMs < 0)));
    await page.getByRole('button', { name: 'Back to capture', exact: true }).click();
    assert.equal(await page.locator('#twoSidedWorkspace').isVisible(), false);
    console.log(`PASS Two-Sided ${width}px: 2 real captures, offset, both directions, downstream context and linked inspection`);
    await page.close();
  }
  console.log(`Screenshots: ${output}`);
} finally {
  await browser?.close();
  await server.close();
}