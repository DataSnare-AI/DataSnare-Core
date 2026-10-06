"use strict";

const sessionContract = DataSnareSessionContract;

function sessionMode() {
  if (!$('#twoSidedWorkspace').hidden) return 'two-sided';
  if (!$('#setWorkspace').hidden) return 'set';
  return 'standard';
}

function sessionFrames(value) {
  const modes = ['capture', 'timeofday', 'datetime', 'previous-captured', 'previous-displayed', 'previous-marked', 'reference', 'epoch'];
  return { marks: Array.isArray(value?.marks) ? [...new Set(value.marks.filter(number => Number.isSafeInteger(number) && number > 0))] : [],
    referenceNumber: Number.isSafeInteger(value?.referenceNumber) && value.referenceNumber > 0 ? value.referenceNumber : null,
    timeMode: modes.includes(value?.timeMode) ? value.timeMode : 'capture' };
}

function sessionNotes(notes, rich = false) {
  if (!notes || typeof notes !== 'object' || Array.isArray(notes)) return {};
  return Object.fromEntries(Object.entries(notes).filter(([number]) => Number.isSafeInteger(Number(number)) && Number(number) > 0)
    .map(([number, note]) => [number, rich ? { html: sanitizeNoteHtml(typeof note?.html === 'string' ? note.html.slice(0, 16000) : ''),
      updatedAt: typeof note?.updatedAt === 'string' ? note.updatedAt : null } : typeof note === 'string' ? note.slice(0, 4000) : '']));
}

function sessionSummary(summary) {
  if (!summary || typeof summary !== 'object') return {};
  return { ...summary, narrative: sanitizeNoteHtml(typeof summary.narrative === 'string' ? summary.narrative : '') };
}

function sessionPacketNotes() {
  return { notes: sessionNotes(captureNotes(), true), frames: sessionFrames(currentFrameState()), summary: sessionSummary(captureSummary()) };
}

function setCaptureAnnotations(metadata) {
  if (!metadata || metadata.size === null || metadata.lastModified === null) return null;
  const id = `${metadata.path || metadata.name}:${metadata.size}:${metadata.lastModified}`;
  const read = key => { try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch (_) { return {}; } };
  return { id, notes: sessionNotes(read(`datasnare-packet-notes:${id}`), true),
    frames: sessionFrames(read(`datasnare-frame-state:${id}`)), summary: sessionSummary(read(`datasnare-capture-summary:${id}`)) };
}

function exportWorkspaceSession() {
  if (batchState.running || twoSidedState.busy || state.backgroundWorkbenchQueued || state.backgroundRenderQueued) {
    showToast('Wait for analysis/render to finish. For a partial set, Stop first, then Save Session.'); return;
  }
  try {
    const mode = sessionMode();
    let data;
    let name;
    if (mode === 'set') {
      if (!batchState.items.length) throw new Error('No capture set to save.');
      name = currentCaptureSetName();
      data = { id: batchState.id, name, items: batchState.items.map(item => ({ name: item.name, path: item.path || item.name,
        metadata: item.metadata || sessionContract.source(item.file, item.path || item.name) })),
        results: batchState.results.map(result => ({ ...sessionContract.select(result, sessionContract.RESULT_FIELDS) })),
        captureAnnotations: batchState.items.map(item => setCaptureAnnotations(item.metadata || sessionContract.source(item.file, item.path || item.name))),
        summary: sessionSummary(captureSetSummary()), search: $('#setSearchInput').value };
    } else if (mode === 'two-sided') {
      if (!twoSidedState.packetsA.length || !twoSidedState.packetsB.length) throw new Error('Analyze both captures before saving.');
      name = 'two-sided';
      const reduced = $('#sessionMatchedOnly').checked || twoSidedState.sessionCoverage === 'matched_pairs_only';
      const pairs = twoSidedState.records.filter(record => record.status === 'matched');
      if (reduced && !pairs.length) throw new Error('No matched pairs to save.');
      const retained = { A: new Set(pairs.map(record => record.packetA.number)), B: new Set(pairs.map(record => record.packetB.number)) };
      const selectedPackets = side => (side === 'A' ? twoSidedState.packetsA : twoSidedState.packetsB).filter(packet => !reduced || retained[side].has(packet.number));
      const notes = side => Object.fromEntries(Object.entries(sessionNotes(twoSidedAnnotations.notes[side])).filter(([number]) => !reduced || retained[side].has(Number(number))));
      const frames = side => { const saved = sessionFrames(twoSidedFrameStates[side]); return reduced ? { ...saved, marks: saved.marks.filter(number => retained[side].has(number)), referenceNumber: retained[side].has(saved.referenceNumber) ? saved.referenceNumber : null } : saved; };
      data = { packetsA: sessionContract.packets(selectedPackets('A')), packetsB: sessionContract.packets(selectedPackets('B')),
        sessionCoverage: reduced ? 'matched_pairs_only' : 'full_metadata',
        capturedDeltas: reduced ? { A: [...twoSidedAnnotations.deltas.A].filter(([number]) => retained.A.has(number)), B: [...twoSidedAnnotations.deltas.B].filter(([number]) => retained.B.has(number)) } : null,
        context: twoSidedState.analysisContext, offsetMs: twoSidedState.offsetMs,
        notes: { A: notes('A'), B: notes('B') },
        frames: { A: frames('A'), B: frames('B') },
        view: { connection: $('#twoSidedConnection').value, context: $('#twoSidedContext').checked, utc: $('#twoSidedUtc').checked,
          status: $('#twoSidedObservationFilter').value, matchedOnly: $('#twoSidedMatchedOnly').getAttribute('aria-pressed') === 'true',
          search: $('#twoSidedSearch').value, page: reduced ? 0 : twoSidedState.page, selected: reduced ? -1 : twoSidedState.selected,
          pageSize: twoSidedPageSize(), scrollTop: $('#twoSidedScroll').scrollTop, scrollLeft: $('#twoSidedScroll').scrollLeft } };
    } else {
      if (!state.packets.length) throw new Error('No individual capture to save.');
      name = state.fileName;
      data = { name: state.fileName, captureId: state.captureId, captureSource: state.captureSource?.name === state.fileName ? state.captureSource : sessionContract.source(null, state.fileName),
        packets: sessionContract.packets(state.packets), ...sessionPacketNotes(),
        view: { workbench: !$('#workbench').hidden, selected: workbenchState.selectedNumber,
          listTop: $('#workbenchListPane').scrollTop, listLeft: $('#workbenchListPane').scrollLeft, search: $('#searchInput').value, protocol: $('#protocolFilter').value,
          workbenchSearch: $('#workbenchSearch').value, workbenchProtocol: $('#workbenchProtocolFilter').value,
          fieldFilters: workbenchState.fieldFilters, columns: workbenchState.columns, activeFlowKey: state.activeFlowKey,
          listHeight: workbenchLayout.listHeight, detailRatio: workbenchLayout.detailRatio,
          streamWidth: $('#workbenchGrid').style.getPropertyValue('--stream-width') } };
    }
    data.skin = document.documentElement.dataset.skin || 'modern';
    const json = sessionContract.encode(mode, data, getActiveAnalysisProfile());
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url;
    link.download = `${name.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 80)}.ainetscope-session.json`;
    link.click(); URL.revokeObjectURL(url);
    $('#sessionStatus').textContent = `Saved ${mode} session${data.sessionCoverage === 'matched_pairs_only' ? ' (matched pairs only; omitted traffic cannot support loss/flow conclusions)' : ''}. Keep originals for relinking.`;
  } catch (error) { showToast(`Session save failed: ${error.message}`); }
}

function setSessionProfile(profile) {
  if (!profile || typeof profile !== 'object') return;
  const safe = { ...profile, focusProtocols: Array.isArray(profile.focusProtocols) ? profile.focusProtocols : [] };
  activeAnalysisProfile = normalizeAnalysisProfile(safe);
  profileStorageWrite('datasnare-active-analysis-profile', activeAnalysisProfile);
  $('#activeProfileName').textContent = activeAnalysisProfile.name;
}

function restoreStandardData(data) {
  state.captureSource = data.captureSource;
  const id = typeof data.captureId === 'string' && data.captureId ? data.captureId : captureFingerprint(data.packets, data.name);
  localStorage.setItem(`datasnare-packet-notes:${id}`, JSON.stringify(sessionNotes(data.notes, true)));
  localStorage.setItem(`datasnare-frame-state:${id}`, JSON.stringify(sessionFrames(data.frames)));
  localStorage.setItem(`datasnare-capture-summary:${id}`, JSON.stringify(sessionSummary(data.summary)));
  workbenchState.notesCaptureId = ''; workbenchState.frameStateCaptureId = ''; workbenchState.frameState = null;
  workbenchState.fieldFilters = Array.isArray(data.view?.fieldFilters) ? data.view.fieldFilters.filter(item => item && typeof item.key === 'string'
    && typeof item.label === 'string' && ['=', '!=', '>', '<', '>=', '<='].includes(item.operator)) : [];
  workbenchState.columns = Array.isArray(data.view?.columns) ? data.view.columns.filter(item => item && typeof item.key === 'string' && typeof item.label === 'string') : [];
  $('#searchInput').value = data.view?.search || '';
  $('#workbenchSearch').value = data.view?.workbenchSearch || '';
  workbenchState.sessionProtocol = typeof data.view?.workbenchProtocol === 'string' ? data.view.workbenchProtocol : 'all';
  workbenchState.selectedNumber = Number.isSafeInteger(data.view?.selected) ? data.view.selected : null;
  if (Number.isFinite(data.view?.listHeight)) {
    workbenchLayout.listHeight = Math.max(140, Math.min(2000, data.view.listHeight));
    $('#workbenchGrid').style.setProperty('--list-height', `${workbenchLayout.listHeight}px`);
  }
  if (Number.isFinite(data.view?.detailRatio)) {
    workbenchLayout.detailRatio = Math.max(.2, Math.min(.8, data.view.detailRatio));
    $('#workbenchGrid').style.setProperty('--detail-ratio', workbenchLayout.detailRatio);
    $('#workbenchGrid').style.setProperty('--bytes-ratio', 1 - workbenchLayout.detailRatio);
  }
  const streamWidth = Number.parseFloat(data.view?.streamWidth);
  if (Number.isFinite(streamWidth)) $('#workbenchGrid').style.setProperty('--stream-width', `${Math.max(280, Math.min(700, streamWidth))}px`);
  const packets = data.packets; packets.compact = true;
  showCoreMode(); loadPackets(packets, data.name, id);
  state.activeFlowKey = typeof data.view?.activeFlowKey === 'string' ? data.view.activeFlowKey : '';
  $('#protocolFilter').value = data.view?.protocol || 'all';
  if (!$('#protocolFilter').value) $('#protocolFilter').value = 'all';
  applyFilters();
  if (data.view?.workbench) {
    workbenchState.sessionListTop = Math.max(0, Number(data.view?.listTop) || 0);
    workbenchState.sessionListLeft = Math.max(0, Number(data.view?.listLeft) || 0);
    showPacketWorkbench();
  }
}

function restoredSetPlaceholder(item, index) {
  return { index, name: item.name, path: item.path || item.name, status: 'Queued', start: 0, end: 0,
    summary: { packets: 0, bytes: 0, duration: 0, throughput: 0, flows: 0, streams: 0, connections: 0, syns: 0, fins: 0,
      latencyP50: null, latencyP95: null, retransmissions: 0, resets: 0, frameAverage: 0, frameP95: 0 },
    protocols: {}, protocolNames: [], services: [], serviceStats: [], findings: [], edges: [], hostTraffic: [], highFindings: 0, mediumFindings: 0, rankedObservations: 0 };
}

function restoreSetData(data) {
  const items = data.items.map(item => ({ name: String(item.name || ''), path: String(item.path || item.name || ''), metadata: item.metadata, file: null }));
  const results = items.map((item, index) => ({ ...restoredSetPlaceholder(item, index),
    ...(data.results.find(row => row.index === index) || {}), source: null, demoPackets: null, needsRelink: true }));
  Object.assign(batchState, { items, results, filtered: [], running: false, cancelled: false, name: data.name || 'Restored capture set', id: data.id || captureSetFingerprint(items) });
  if (Array.isArray(data.captureAnnotations)) data.captureAnnotations.slice(0, items.length).forEach((annotation, index) => {
    const metadata = items[index].metadata;
    const id = `${metadata.path || metadata.name}:${metadata.size}:${metadata.lastModified}`;
    if (!annotation || annotation.id !== id) return;
    localStorage.setItem(`datasnare-packet-notes:${id}`, JSON.stringify(sessionNotes(annotation.notes, true)));
    localStorage.setItem(`datasnare-frame-state:${id}`, JSON.stringify(sessionFrames(annotation.frames)));
    localStorage.setItem(`datasnare-capture-summary:${id}`, JSON.stringify(sessionSummary(annotation.summary)));
  });
  $('#captureSetName').value = batchState.name;
  $('#setSearchInput').value = data.search || '';
  localStorage.setItem(setSummaryStorageKey(), JSON.stringify(sessionSummary(data.summary)));
  showSetMode(); $('#setEmptyState').hidden = !!items.length; $('#setDashboard').hidden = !items.length;
  $('#cancelSetButton').hidden = true; $('#setSummaryButton').hidden = false;
  renderCaptureSet(); updateSetSummaryTrigger();
  setProgress('Session restored. Completed summaries are available; relink originals to open captures or resume unfinished files.', 'complete');
}

function restoreTwoSidedData(data) {
  const context = data.context;
  const records = DataSnareTwoSidedMatch.correlate(data.packetsA, data.packetsB, { offsetMs: data.offsetMs,
    toleranceMs: context.toleranceMs, hostA: context.hostA || '', hostB: context.hostB || '' });
  Object.assign(twoSidedState, { packetsA: data.packetsA, packetsB: data.packetsB, records,
    sessionCoverage: data.sessionCoverage === 'matched_pairs_only' ? 'matched_pairs_only' : 'full_metadata',
    offsetMs: data.offsetMs, analysisContext: context, page: Math.max(0, Number(data.view?.page) || 0), selected: Number.isInteger(data.view?.selected) ? data.view.selected : -1 });
  ['A', 'B'].forEach((side, index) => {
    prepareTwoSidedAnnotations(side, context.sources[index], side === 'A' ? data.packetsA : data.packetsB);
    if (twoSidedState.sessionCoverage === 'matched_pairs_only' && Array.isArray(data.capturedDeltas?.[side])) {
      twoSidedAnnotations.deltas[side] = new Map(data.capturedDeltas[side].filter(entry => Array.isArray(entry) && Number.isSafeInteger(entry[0]) && (entry[1] === null || Number.isFinite(entry[1]))));
    }
    twoSidedAnnotations.notes[side] = sessionNotes(data.notes?.[side]);
    twoSidedFrameStates[side] = sessionFrames(data.frames?.[side]);
    localStorage.setItem(twoSidedAnnotations.keys[side], JSON.stringify(twoSidedAnnotations.notes[side]));
    localStorage.setItem(`${twoSidedAnnotations.keys[side]}:frames`, JSON.stringify(twoSidedFrameStates[side]));
    $(`#twoSidedName${side}`).textContent = `System ${side} / ${context.sources[index].name} / restored metadata`;
    const input = $(`#twoSidedFile${side}`); input.value = '';
  });
  $('#twoSidedOffset').value = data.offsetMs; $('#twoSidedTolerance').value = context.toleranceMs;
  $('#twoSidedHostA').value = context.hostA || ''; $('#twoSidedHostB').value = context.hostB || '';
  const connections = [...new Set(records.map(record => record.connection))];
  $('#twoSidedConnection').innerHTML = '<option value="all">All connections</option>' + connections.map(connection => `<option value="${escapeHtml(connection)}">${escapeHtml(connection)}</option>`).join('');
  $('#twoSidedConnection').value = data.view?.connection || 'all';
  if (!$('#twoSidedConnection').value) $('#twoSidedConnection').value = 'all';
  $('#twoSidedContext').checked = data.view?.context !== false; $('#twoSidedUtc').checked = data.view?.utc === true;
  $('#twoSidedObservationFilter').value = ['all', 'matched', 'ambiguous', 'unmatched'].includes(data.view?.status) ? data.view.status : 'all';
  $('#twoSidedSearch').value = data.view?.search || '';
  $('#twoSidedMatchedOnly').setAttribute('aria-pressed', String(data.view?.matchedOnly === true));
  $('#twoSidedMatchedOnly').textContent = data.view?.matchedOnly ? 'Show All Observations' : 'Show Matched Only';
  settings.twoSidedRowsPerPage = Math.max(25, Math.min(1000, Number(data.view?.pageSize) || 150));
  $('#twoSidedStatus').textContent = `${data.packetsA.length} A frames / ${data.packetsB.length} B frames / restored metadata / B offset ${data.offsetMs} ms`;
  showTwoSided();
  $('#twoSidedScroll').scrollTop = Math.max(0, Number(data.view?.scrollTop) || 0);
  $('#twoSidedScroll').scrollLeft = Math.max(0, Number(data.view?.scrollLeft) || 0);
}

async function restoreWorkspaceSession(file) {
  if (!file) return;
  if (batchState.running || twoSidedState.busy || state.backgroundRenderQueued || state.backgroundWorkbenchQueued) {
    showToast('Stop analysis and wait for rendering before restoring a session.'); return;
  }
  try {
    if (file.size > sessionContract.MAX_BYTES) throw new Error('Session files are limited to 100 MiB.');
    const session = sessionContract.decode(await file.text());
    if (!confirm(`Restore ${session.mode} session? This replaces the current ${session.mode} workspace. Save current work first.`)) return;
    setSessionProfile(session.profile);
    applyAINetScopeTheme(session.data.skin || 'modern', true);
    if (session.mode === 'standard') restoreStandardData(session.data);
    else if (session.mode === 'set') restoreSetData(session.data);
    else restoreTwoSidedData(session.data);
    $('#sessionRelinkButton').disabled = false;
    $('#sessionResumeButton').disabled = true;
    $('#sessionMatchedOnly').checked = session.mode === 'two-sided' && twoSidedState.sessionCoverage === 'matched_pairs_only';
    $('#sessionStatus').textContent = `Restored ${session.mode} session: ${session.mode === 'two-sided' && twoSidedState.sessionCoverage === 'matched_pairs_only' ? 'matched pairs only; unmatched/ambiguous traffic omitted' : 'metadata only'}. Relink originals for full evidence. Notes may contain sensitive data.`;
  } catch (error) { showToast(`Session restore failed: ${error.message}`); }
}

async function relinkSessionFiles(files) {
  const mode = sessionMode();
  if (batchState.running || twoSidedState.busy) { showToast('Wait for analysis to finish before relinking.'); return; }
  try {
    if (mode === 'set') {
      let linked = 0;
      batchState.items.forEach((item, index) => {
        const matches = sessionContract.matches(item.metadata, files);
        if (matches.length !== 1) return;
        item.file = matches[0];
        const result = batchState.results.find(result => result.index === index);
        if (result) { result.source = matches[0]; result.needsRelink = false; }
        linked++;
      });
      $('#sessionStatus').textContent = `Relinked ${linked} capture files. Nonmatching or duplicate identities remain unresolved. Resume runs only unfinished linked files.`;
      $('#sessionResumeButton').disabled = !batchState.results.some(result => result.status !== 'Analyzed' && result.source);
    } else if (mode === 'standard') {
      const matches = sessionContract.matches(state.captureSource, files);
      if (matches.length !== 1) throw new Error('Select one original capture with matching name, size and modification time.');
      const selected = workbenchState.selectedNumber;
      const id = state.captureId;
      const packets = await parseFile(matches[0], true, { compactThreshold: SINGLE_CAPTURE_COMPACT_THRESHOLD });
      if (captureFingerprint(packets, state.fileName) !== captureFingerprint(state.packets, state.fileName)) throw new Error('Capture metadata does not match the saved session.');
      const workbench = !$('#workbench').hidden;
      loadPackets(packets, state.fileName, id); if (workbench) showPacketWorkbench(selected);
      $('#sessionStatus').textContent = 'Original capture relinked. Raw byte inspection is available.';
    } else {
      const context = twoSidedState.analysisContext;
      const sources = context.sources.map(metadata => sessionContract.matches(metadata, files));
      if (sources.some(matches => matches.length !== 1)) throw new Error('Select both original captures with unique matching name, size and modification time.');
      const packetsA = await parseFile(sources[0][0], false); const packetsB = await parseFile(sources[1][0], false);
      const verify = (full, saved, name) => {
        if (twoSidedState.sessionCoverage !== 'matched_pairs_only') return captureFingerprint(full, name) === captureFingerprint(saved, name);
        const indexed = new Map(full.map(packet => [packet.number, packet]));
        return saved.every(packet => { const original = indexed.get(packet.number); return original && ['timestamp', 'length', 'seq', 'ack', 'src', 'dst', 'payloadLength'].every(key => original[key] === packet[key]); });
      };
      if (!verify(packetsA, twoSidedState.packetsA, context.sources[0].name) || !verify(packetsB, twoSidedState.packetsB, context.sources[1].name)) throw new Error('Capture metadata does not match the session.');
      Object.assign(twoSidedState, { packetsA, packetsB, records: DataSnareTwoSidedMatch.correlate(packetsA, packetsB,
        { offsetMs: twoSidedState.offsetMs, toleranceMs: context.toleranceMs, hostA: context.hostA, hostB: context.hostB }) });
      sources.forEach((matches, index) => { const transfer = new DataTransfer(); transfer.items.add(matches[0]); $(`#twoSidedFile${index ? 'B' : 'A'}`).files = transfer.files; });
      twoSidedState.sessionCoverage = 'full_metadata'; $('#sessionMatchedOnly').checked = false;
      ['A', 'B'].forEach((side, index) => {
        const notes = twoSidedAnnotations.notes[side]; const frames = twoSidedFrameStates[side];
        prepareTwoSidedAnnotations(side, sources[index][0], index ? packetsB : packetsA);
        twoSidedAnnotations.notes[side] = notes; twoSidedFrameStates[side] = frames;
      });
      renderTwoSided(); $('#sessionStatus').textContent = 'Both original captures relinked; notes, marks and clock context preserved.';
    }
  } catch (error) { showToast(`Relink failed: ${error.message}`); }
}

async function resumeSetSession() {
  if (batchState.running || sessionMode() !== 'set') return;
  batchState.running = true; batchState.cancelled = false; $('#cancelSetButton').hidden = false;
  try {
    for (const result of [...batchState.results]) {
      if (batchState.cancelled) break;
      if (result.status === 'Analyzed' || !result.source) continue;
      setProgress(`Resuming ${result.path}`);
      try {
        const packets = await parseFile(result.source, false);
        if (!packets.length) throw new Error('No packet records');
        const updated = await backgroundSummarizeSetFile(packets, batchState.items[result.index], result.index);
        updated.source = result.source;
        batchState.results[batchState.results.indexOf(result)] = updated;
      } catch (error) { result.status = 'Failed'; result.error = error.message; }
      renderCaptureSet();
    }
  } finally {
    batchState.running = false; $('#cancelSetButton').hidden = true; $('#sessionResumeButton').disabled = true;
    setProgress('Resume finished. Completed results retained; unlinked captures remain pending. Save Session to retain new progress.', 'complete');
    renderCaptureSet();
  }
}

$('#sessionSaveButton').addEventListener('click', exportWorkspaceSession);
$('#sessionRestoreButton').addEventListener('click', () => $('#sessionRestoreInput').click());
$('#sessionRestoreInput').addEventListener('change', event => { const file = event.target.files[0]; event.target.value = ''; restoreWorkspaceSession(file); });
$('#sessionRelinkButton').addEventListener('click', () => $('#sessionRelinkInput').click());
$('#sessionRelinkInput').addEventListener('change', event => { const files = [...event.target.files]; event.target.value = ''; relinkSessionFiles(files); });
$('#sessionResumeButton').addEventListener('click', resumeSetSession);