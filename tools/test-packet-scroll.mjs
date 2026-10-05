import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, open: false } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${server.resolvedUrls.local[0]}ainetscope/index.html`);
    await page.evaluate(() => {
      state.packets = Array.from({ length: 30000 }, (_, index) => ({ number: index + 1,
        timestamp: 1700000000 + index / 1000, length: 64, protocol: 'TEST', transport: '',
        src: '192.0.2.1', dst: '192.0.2.2', info: `Scroll fixture ${index + 1}` }));
      state.fileName = 'scroll-fixture.pcap';
      state.captureId = 'scroll-regression';
      const flagSets = [['SYN'], ['SYN', 'ACK'], ['FIN'], ['FIN', 'ACK'], ['RST', 'SYN', 'ACK']];
      flagSets.forEach((flags, index) => { state.packets[index].flags = flags; });
      showPacketWorkbench(1);
    });
    await page.locator('#workbenchRows tr[data-workbench-packet="1"]').waitFor();
    const signalColors = await page.locator('#workbenchRows .tcp-signal').evaluateAll(elements => elements.slice(0, 5).map(element => ({
      className: element.className, color: getComputedStyle(element).color,
    })));
    assert.deepEqual(signalColors.map(item => item.className.split('--')[1]), ['syn', 'syn-ack', 'fin', 'fin-ack', 'rst']);
    assert.deepEqual(signalColors.map(item => item.color), ['rgb(23, 93, 160)', 'rgb(23, 102, 55)', 'rgb(152, 75, 11)', 'rgb(9, 107, 112)', 'rgb(180, 35, 24)']);
    console.log(`PASS ${width}px: Packets TCP flag palette and RST precedence`);
    if (width > 900) {
      const rowHandle = page.getByRole('separator', { name: 'Resize packet list and details' });
      const columnHandle = page.getByRole('separator', { name: 'Resize packet details and bytes' });
      const dimensions = () => page.evaluate(() => ({
        list: document.querySelector('#workbenchListPane').getBoundingClientRect().height,
        detail: document.querySelector('.workbench-detail-pane').getBoundingClientRect().width,
        bytes: document.querySelector('.workbench-bytes-pane').getBoundingClientRect().width,
      }));
      const before = await dimensions();
      await rowHandle.scrollIntoViewIfNeeded();
      const rowBox = await rowHandle.boundingBox();
      await page.mouse.move(rowBox.x + rowBox.width / 2, rowBox.y + rowBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(rowBox.x + rowBox.width / 2, rowBox.y + rowBox.height / 2 + 80, { steps: 8 });
      await page.mouse.up();
      assert.ok((await dimensions()).list > before.list + 60, `Horizontal divider should enlarge the packet list: ${JSON.stringify({ before, after: await dimensions(), rowBox })}`);
      await columnHandle.scrollIntoViewIfNeeded();
      const columnBox = await columnHandle.boundingBox();
      await page.mouse.move(columnBox.x + columnBox.width / 2, columnBox.y + columnBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(columnBox.x + columnBox.width / 2 + 60, columnBox.y + columnBox.height / 2, { steps: 6 });
      await page.mouse.up();
      const resized = await dimensions();
      assert.ok(resized.detail > before.detail + 40, 'Vertical divider should enlarge details');
      assert.ok(resized.bytes < before.bytes - 40, 'Vertical divider should shrink bytes');
      await columnHandle.press('ArrowLeft');
      assert.ok((await dimensions()).detail < resized.detail - 5, 'Keyboard resize should move divider');
      console.log('PASS desktop pane drag and keyboard resizing');
    }
    const inspect = () => page.evaluate(() => ({
      scrollTop: document.querySelector('#workbenchListPane').scrollTop,
      firstFrame: Number(document.querySelector('#workbenchRows tr[data-workbench-packet]').dataset.workbenchPacket),
      selected: workbenchState.selectedNumber,
    }));
    for (const scrollTop of [20000, 80000, 160000]) {
      await page.evaluate(value => { document.querySelector('#workbenchListPane').scrollTop = value; }, scrollTop);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
      const snapshot = await inspect();
      assert.ok(Math.abs(snapshot.scrollTop - scrollTop) < 2, `Scroll snapped back: ${JSON.stringify(snapshot)}`);
      assert.ok(snapshot.firstFrame > 300, `Window did not advance: ${JSON.stringify(snapshot)}`);
      assert.equal(snapshot.selected, 1, 'Scrolling should retain selection without recentering');
    }
    await page.getByRole('spinbutton', { name: 'Go to Packet number', exact: true }).fill('20000');
    await page.locator('#workbenchJumpForm').getByRole('button', { name: 'Go', exact: true }).click();
    await page.locator('#workbenchRows tr[data-workbench-packet="20000"].selected').waitFor();
    assert.equal((await inspect()).selected, 20000);
    await page.getByRole('spinbutton', { name: 'Go to Packet number', exact: true }).fill('99999');
    await page.locator('#workbenchJumpForm').getByRole('button', { name: 'Go', exact: true }).click();
    assert.match(await page.locator('#workbenchJumpStatus').textContent(), /not in this capture/);
    assert.equal((await inspect()).selected, 20000);
    await page.locator('#workbenchSearch').fill('Scroll fixture 30000');
    await page.getByRole('spinbutton', { name: 'Go to Packet number', exact: true }).fill('20000');
    await page.locator('#workbenchJumpForm').getByRole('button', { name: 'Go', exact: true }).click();
    assert.match(await page.locator('#workbenchJumpStatus').textContent(), /hidden by active filters/);
    await page.locator('#workbenchSearch').fill('');
    await page.evaluate(() => selectWorkbenchPacket(1, true));
    await page.locator('#workbenchRows tr[data-workbench-packet="1"].selected').waitFor();
    assert.ok((await inspect()).scrollTop < 100);
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px: 30,000-frame scrolling remains stable; explicit frame navigation recenters`);
    await page.close();
  }
} finally {
  await browser?.close();
  await server.close();
}