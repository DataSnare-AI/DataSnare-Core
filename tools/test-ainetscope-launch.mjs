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
  assert.ok((await analyzer.locator('#workspace').getByLabel('Previous packet filters').boundingBox()).width >= 176, 'Filter history label must have enough width');
  await analyzer.locator('#searchInput').fill('(TCP || DNS) && !never-matches');
  await analyzer.locator('#searchInput').press('Enter');
  const coreFilteredFrames = await analyzer.evaluate(() => state.filtered.map(packet => packet.number));
  assert.ok(coreFilteredFrames.length > 0);
  assert.equal(await analyzer.locator('#searchInput').getAttribute('data-filter-validity'), 'valid');
  await analyzer.locator('#searchInput').fill('TCP ||');
  await analyzer.locator('#searchInput').press('Enter');
  assert.equal(await analyzer.locator('#searchInput').getAttribute('aria-invalid'), 'true');
  assert.deepEqual(await analyzer.evaluate(() => state.filtered.map(packet => packet.number)), coreFilteredFrames);
  await analyzer.locator('#searchInput').fill('');
  await analyzer.locator('#searchInput').press('Enter');
  await analyzer.evaluate(() => showPacketWorkbench());
  await analyzer.locator('#workbenchSearch').fill('(TCP || DNS) && !never-matches');
  await analyzer.locator('#workbenchSearch').press('Enter');
  assert.deepEqual(await analyzer.evaluate(() => workbenchState.packets.map(packet => packet.number)), coreFilteredFrames);
  assert.ok(await analyzer.evaluate(() => JSON.parse(localStorage.getItem('datasnare-packet-filter-history-v1')).includes('(TCP || DNS) && !never-matches')));
  await analyzer.locator('#workbenchSearch').fill('');
  await analyzer.locator('#workbenchSearch').press('Enter');
  await analyzer.evaluate(() => showCoreMode());
  console.log('PASS shared filters: Boolean grouping, validation, last-valid retention, history, Core/Packets parity');
  const beforeHelp = await analyzer.evaluate(() => state.filtered.map(packet => packet.number));
  await analyzer.getByRole('button', { name: 'Core filter syntax help', exact: true }).click();
  const help = analyzer.getByRole('dialog', { name: 'Filter syntax help', exact: true });
  await help.waitFor({ state: 'visible' });
  assert.ok((await help.textContent()).includes('ip.addr'));
  assert.match(await help.textContent(), /IPv4\/IPv6 CIDR network.*starts_with.*matches/s);
  assert.doesNotMatch(await help.textContent(), /matches.*not implemented/s);
  await help.getByRole('button', { name: 'Display Filter: ip.addr == 10.242.88.7 and tds', exact: true }).click();
  assert.equal(await analyzer.getByLabel('Core filter mode', { exact: true }).inputValue(), 'display');
  assert.equal(await analyzer.locator('#searchInput').inputValue(), 'ip.addr == 10.242.88.7 and tds');
  assert.deepEqual(await analyzer.evaluate(() => state.filtered.map(packet => packet.number)), beforeHelp, 'Inserting help examples must not apply them');
  await analyzer.evaluate(() => showPacketWorkbench());
  await analyzer.getByRole('button', { name: 'Packets filter syntax help', exact: true }).click();
  await help.waitFor({ state: 'visible' });
  await help.getByRole('button', { name: 'Text: Rbt || TDS', exact: true }).click();
  assert.equal(await analyzer.locator('#workbenchSearch').inputValue(), 'Rbt || TDS');
  await analyzer.locator('#workbenchSearch').fill('');
  await analyzer.locator('#workbenchSearch').press('Enter');
  await analyzer.evaluate(() => showCoreMode());
  await analyzer.setViewportSize({ width: 390, height: 844 });
  await analyzer.getByRole('button', { name: 'Core filter syntax help', exact: true }).click();
  await help.waitFor({ state: 'visible' });
  const helpBounds = await help.boundingBox();
  assert.ok(helpBounds.x >= 0 && helpBounds.x + helpBounds.width <= 390, 'Syntax help must fit the mobile viewport');
  await help.press('Escape');
  assert.equal(await help.count(), 0, 'Escape should dismiss syntax help');
  await analyzer.setViewportSize({ width: 1440, height: 1000 });
  console.log('PASS syntax help: registry reference, unapplied examples, mobile fit and Escape dismissal');
  await analyzer.getByLabel('Core filter mode', { exact: true }).selectOption('display');
  const beforeCompletion = await analyzer.evaluate(() => state.filtered.map(packet => packet.number));
  await analyzer.locator('#searchInput').fill('ip.');
  const coreSuggestions = analyzer.locator('#searchInputSuggestions');
  await coreSuggestions.getByRole('option', { name: 'ip.addr', exact: false }).click();
  assert.equal(await analyzer.locator('#searchInput').inputValue(), 'ip.addr ');
  await analyzer.locator('#searchInput').press('ArrowDown');
  assert.deepEqual(await coreSuggestions.getByRole('option').allTextContents(), ['==Exact equality', '!=Not equal', 'inCIDR network membership']);
  await analyzer.locator('#searchInput').press('Enter');
  assert.equal(await analyzer.locator('#searchInput').inputValue(), 'ip.addr == ');
  assert.deepEqual(await analyzer.evaluate(() => state.filtered.map(packet => packet.number)), beforeCompletion);
  await analyzer.locator('#searchInput').fill('td');
  await analyzer.locator('#searchInput').press('Tab');
  assert.equal(await analyzer.locator('#searchInput').inputValue(), 'tds ');
  assert.equal(await analyzer.locator('#searchInput').getAttribute('aria-expanded'), 'false');
  await analyzer.locator('#searchInput').fill('ip.');
  await analyzer.locator('#searchInput').press('Escape');
  assert.equal(await analyzer.locator('#searchInput').getAttribute('aria-expanded'), 'false');
  await analyzer.locator('#searchInput').fill('ip.src == ');
  const observedIpOption = coreSuggestions.getByRole('option').first();
  await observedIpOption.waitFor({ state: 'visible' });
  const observedSource = await observedIpOption.locator('strong').innerText();
  assert.match(await observedIpOption.innerText(), /Observed in sampled packets/);
  assert.equal(await analyzer.evaluate(value => state.packets.some(packet => packet.src === value || packet.dst === value), observedSource), true);
  await observedIpOption.click();
  assert.equal(await analyzer.locator('#searchInput').inputValue(), `ip.src == ${observedSource} `);
  assert.deepEqual(await analyzer.evaluate(() => state.filtered.map(packet => packet.number)), beforeCompletion);
  await analyzer.setViewportSize({ width: 390, height: 844 });
  await analyzer.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await analyzer.locator('#searchInput').fill('ip.');
  await coreSuggestions.waitFor({ state: 'visible' });
  const suggestionBounds = await coreSuggestions.boundingBox();
  assert.ok(suggestionBounds.x >= 0 && suggestionBounds.x + suggestionBounds.width <= 390, 'Autocomplete must fit the mobile viewport');
  await analyzer.locator('#searchInput').press('Escape');
  await analyzer.setViewportSize({ width: 1440, height: 1000 });
  await analyzer.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await analyzer.evaluate(() => showPacketWorkbench());
  await analyzer.getByLabel('Packets filter mode', { exact: true }).selectOption('display');
  const observedPort = await analyzer.evaluate(() => {
    const input = document.querySelector('#workbenchSearch');
    input.focus();
    input.value = 'tcp.dstport == ';
    input.setSelectionRange(input.value.length, input.value.length);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const option = document.querySelector('#workbenchSearchSuggestions strong');
    if (!option || document.querySelector('#workbenchSearchSuggestions').hidden) return null;
    const value = option.textContent;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    return value;
  });
  assert.ok(observedPort, 'Packets should offer captured port values');
  assert.equal(await analyzer.evaluate(value => state.packets.some(packet => packet.transport === 'TCP' && packet.dstPort === Number(value)), observedPort), true);
  assert.equal(await analyzer.locator('#workbenchSearch').inputValue(), `tcp.dstport == ${observedPort} `);
  await analyzer.locator('#workbenchSearch').fill('');
  await analyzer.locator('#workbenchSearch').press('Enter');
  await analyzer.evaluate(() => showCoreMode());
  console.log('PASS registry autocomplete: fields/operators/protocols, pointer and keyboard acceptance, Escape, unapplied drafts');
  const displayExpression = await analyzer.evaluate(() => `ip.addr == ${state.packets.find(packet => packet.transport === 'TCP').src} and tcp`);
  await analyzer.getByLabel('Core filter mode', { exact: true }).selectOption('display');
  await analyzer.locator('#searchInput').fill(displayExpression);
  await analyzer.locator('#searchInput').press('Enter');
  const displayFrames = await analyzer.evaluate(() => state.filtered.map(packet => packet.number));
  assert.ok(displayFrames.length > 0);
  const reportFilterScope = await analyzer.evaluate(() => {
    const jsonFilter = buildExportReport().capture.filter;
    const html = buildSingleCaptureReportHtml(buildSingleCaptureReportData());
    return { jsonFilter, pdfIncludesFilter: html.includes('Applied Display Filter') && html.includes(`${jsonFilter.matched} of ${jsonFilter.total} packets`)
      && html.includes(jsonFilter.expression) };
  });
  assert.deepEqual(reportFilterScope.jsonFilter, { mode: 'display', expression: displayExpression, matched: displayFrames.length,
    total: await analyzer.evaluate(() => state.packets.length), protocol: 'all' });
  assert.equal(reportFilterScope.pdfIncludesFilter, true, 'PDF must disclose the applied expression and matched/total count');
  const setReportLinks = await analyzer.evaluate(() => {
    const model = DataSnareCaptureSetReport.buildCaptureSetReportModel({
      results: [{ index: 0, name: 'source.pcap', path: 'source.pcap', status: 'Analyzed', summary: { packets: 1, bytes: 60 } }],
      totals: { files: 1, packets: 1, bytes: 60 },
      findings: [{ title: 'Reset signal', detail: 'Evidence', severity: 'high', index: 0, packet: 7 }],
      inventorySearch: 'source.pcap'
    });
    const html = DataSnareCaptureSetReport.renderCaptureSetReportHtml(model);
    return html.includes('href="#capture-file-0"') && html.includes('source.pcap · Frame 7')
      && html.includes('interactive inventory search “source.pcap” is display-only');
  });
  assert.equal(setReportLinks, true, 'Capture Set findings should link to source inventory rows and disclose report search scope');
  const hostPrefix = await analyzer.evaluate(() => state.packets.find(packet => packet.httpHost)?.httpHost.slice(0, 4));
  assert.ok(hostPrefix, 'Demo capture should retain a decoded HTTP Host value');
  const prefixExpression = `ip.src in 0.0.0.0/0 and http.host starts_with ${JSON.stringify(hostPrefix)}`;
  await analyzer.locator('#searchInput').fill(prefixExpression);
  await analyzer.locator('#searchInput').press('Enter');
  const prefixFrames = await analyzer.evaluate(prefix => state.packets.filter(packet => packet.src.split('.').length === 4
    && packet.httpHost?.toLowerCase().startsWith(prefix.toLowerCase())).map(packet => packet.number), hostPrefix);
  assert.deepEqual(await analyzer.evaluate(() => state.filtered.map(packet => packet.number)), prefixFrames);
  const regexExpression = `ip.src in 0.0.0.0/0 and http.host matches ${JSON.stringify('^example.*$')}`;
  await analyzer.locator('#searchInput').fill(regexExpression);
  await analyzer.locator('#searchInput').press('Enter');
  const regexFrames = await analyzer.evaluate(() => state.packets.filter(packet => packet.src.split('.').length === 4
    && /^example.*$/i.test(packet.httpHost || '')).map(packet => packet.number));
  assert.deepEqual(await analyzer.evaluate(() => state.filtered.map(packet => packet.number)), regexFrames);
  await analyzer.locator('#searchInput').fill(displayExpression);
  await analyzer.locator('#searchInput').press('Enter');
  await analyzer.locator('#searchInput').fill('op.addr == 10.0.0.1');
  assert.equal(await analyzer.locator('#searchInput').getAttribute('aria-invalid'), 'true');
  assert.deepEqual(await analyzer.evaluate(() => state.filtered.map(packet => packet.number)), displayFrames);
  await analyzer.locator('#searchInput').fill(displayExpression);
  await analyzer.locator('#searchInput').press('Enter');
  await analyzer.evaluate(() => showPacketWorkbench());
  await analyzer.getByLabel('Packets filter mode', { exact: true }).selectOption('display');
  await analyzer.locator('#workbenchSearch').fill(displayExpression);
  await analyzer.locator('#workbenchSearch').press('Enter');
  assert.deepEqual(await analyzer.evaluate(() => workbenchState.packets.map(packet => packet.number)), displayFrames);
  const constrainedProtocol = await analyzer.evaluate(() => workbenchState.packets[0].protocol);
  await analyzer.locator('#workbenchProtocolFilter').selectOption(constrainedProtocol);
  const protocolFrames = await analyzer.evaluate(frames => state.packets.filter(packet => frames.includes(packet.number) && packet.protocol === $('#workbenchProtocolFilter').value).map(packet => packet.number), displayFrames);
  assert.deepEqual(await analyzer.evaluate(() => workbenchState.packets.map(packet => packet.number)), protocolFrames, 'Protocol dropdown must remain an AND constraint');
  const fieldConstraint = await analyzer.evaluate(frames => {
    const packet = workbenchState.packets[0];
    const value = new Date(packet.timestamp * 1000).toISOString();
    workbenchState.fieldFilters = [{ key: 'Frame\u001fArrival time', label: 'Frame Arrival time', operator: '=', value }];
    renderWorkbenchList();
    return state.packets.filter(candidate => frames.includes(candidate.number) && candidate.protocol === $('#workbenchProtocolFilter').value
      && new Date(candidate.timestamp * 1000).toISOString() === value).map(candidate => candidate.number);
  }, displayFrames);
  assert.deepEqual(await analyzer.evaluate(() => workbenchState.packets.map(packet => packet.number)), fieldConstraint, 'Workbench field filters must remain AND constraints');
  await analyzer.evaluate(() => { workbenchState.fieldFilters = []; $('#workbenchProtocolFilter').value = 'all'; renderWorkbenchList(); });
  assert.equal(await analyzer.evaluate(() => workbenchPacketFilter.mode), 'display');
  assert.ok(await analyzer.evaluate(() => JSON.parse(localStorage.getItem('datasnare-packet-filter-history-v1:display')).length > 0));
  await analyzer.locator('#workbenchSearch').fill('');
  await analyzer.locator('#workbenchSearch').press('Enter');
  await analyzer.getByLabel('Packets filter mode', { exact: true }).selectOption('text');
  await analyzer.locator('#workbenchSearch').press('Enter');
  await analyzer.evaluate(() => showCoreMode());
  await analyzer.locator('#searchInput').fill('');
  await analyzer.getByLabel('Core filter mode', { exact: true }).selectOption('text');
  await analyzer.locator('#searchInput').press('Enter');
  console.log('PASS typed display filters: IP/transport predicate, invalid field retention, mode-specific history, Core/Packets parity');
  await analyzer.locator('#timelineCanvas').hover({ position: { x: 100, y: 60 } });
  await analyzer.locator('#timelineTooltip').waitFor({ state: 'visible' });
  assert.match(await analyzer.locator('#timelineTooltip').textContent(), /Start \(UTC\).*End \(UTC\).*Inbound.*Outbound.*Packets/s);
  await analyzer.getByLabel('Throughput time axis').selectOption('utc');
  assert.equal(await analyzer.locator('#timelineTooltip').isHidden(), true, 'Redrawing must clear stale hover data');
  await analyzer.locator('#timelineCanvas').hover({ position: { x: 150, y: 70 } });
  assert.equal(await analyzer.locator('#timelineTooltip').isVisible(), true);
  await analyzer.getByLabel('Throughput time axis').selectOption('relative');
  console.log('PASS throughput timeline: hover UTC bucket timestamps and selectable time axis');
  await analyzer.evaluate(() => {
    showPacketWorkbench();
    const original = { packets: state.packets, flows: state.flows, workbenchPackets: workbenchState.packets, selected: workbenchState.selectedNumber };
    const forward = { transport: 'TCP', protocol: 'TCP', src: '10.0.0.1', dst: '10.0.0.2', srcPort: 50000, dstPort: 443 };
    const reverse = { transport: 'TCP', protocol: 'TCP', src: '10.0.0.2', dst: '10.0.0.1', srcPort: 443, dstPort: 50000 };
    state.packets = [
      { ...forward, number: 1, timestamp: 1, length: 60, flags: ['SYN'], info: 'SYN' },
      { ...reverse, number: 2, timestamp: 2, length: 60, flags: ['SYN', 'ACK'], info: 'SYN ACK' },
      { ...forward, number: 3, timestamp: 3, length: 100, protocol: 'HTTP', flags: ['FIN', 'RST'], httpStatus: 503, info: 'HTTP 503' },
      { ...reverse, number: 4, timestamp: 4, length: 80, protocol: 'TDS', flags: ['ACK'], tdsError: true, tdsErrorCount: 1, info: 'TDS error' }
    ];
    state.flows = [{ key: DataSnareStreamInspector.streamKey(state.packets[0]) }];
    renderStreamInspector(state.packets[2]);
    window.__streamMiniMapRestore = () => {
      state.packets = original.packets; state.flows = original.flows; workbenchState.packets = original.workbenchPackets;
      workbenchState.selectedNumber = original.selected; showCoreMode(); delete window.__streamMiniMapRestore;
    };
  });
  const streamMiniMap = analyzer.locator('#streamInspector');
  const directionA = streamMiniMap.locator('[data-stream-packet="1"] .stream-direction');
  const directionB = streamMiniMap.locator('[data-stream-packet="2"] .stream-direction');
  assert.equal(await directionA.textContent(), 'A → B');
  assert.equal(await directionB.textContent(), 'B → A');
  assert.notEqual(await directionA.evaluate(element => getComputedStyle(element).color), await directionB.evaluate(element => getComputedStyle(element).color));
  assert.equal(await streamMiniMap.locator('[data-stream-packet="3"] .stream-markers').innerText(), 'RST\nHTTP 5xx\nFIN');
  assert.equal(await streamMiniMap.locator('[data-stream-packet="3"]').getAttribute('aria-current'), 'true');
  assert.match(await streamMiniMap.getByLabel('Stream mini-map legend').innerText(), /A → B.*B → A.*SYN.*FIN.*RST.*ERR/s);
  const synRow = streamMiniMap.locator('[data-stream-packet="1"]');
  await synRow.focus();
  await synRow.press('Enter');
  assert.equal(await streamMiniMap.locator('[data-stream-packet="1"]').getAttribute('aria-current'), 'true', 'Keyboard activation should move the selected-frame cue');
  await analyzer.setViewportSize({ width: 390, height: 844 });
  await analyzer.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const mobileMiniMap = await streamMiniMap.boundingBox();
  assert.ok(mobileMiniMap && mobileMiniMap.width <= 390, 'Stream mini-map should fit the mobile viewport');
  assert.ok((await analyzer.evaluate(() => document.documentElement.scrollWidth)) <= 391, 'Mini-map should not cause mobile page overflow');
  await analyzer.evaluate(() => window.__streamMiniMapRestore());
  await analyzer.setViewportSize({ width: 1440, height: 1000 });
  console.log('PASS stream mini-map: independent direction colors, ordered SYN/FIN/RST and error markers, selected cue, legend, mobile fit');
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