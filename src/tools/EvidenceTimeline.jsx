import { useEffect, useMemo, useRef, useState } from 'react';
import { X, ZoomIn, ZoomOut } from 'lucide-react';
import { clusterTimelineEvents } from './timelineClusters';
import { matchesTimelineSearch } from './timelineSearch';
import { resolveTimelineViewport } from './timelineViewport';
import { adjustInvestigationWindow, clipInterval, epochOf, toLocalDateTime, toOffsetISOString } from './investigationTime';

const WIDTH = 1200;
const HEIGHT = 400;
const LEFT = 72;
const RIGHT = 1128;
const AXIS_Y = 190;
const SEVERITY_COLOR = {
  critical: '#c43d32',
  error: '#d75b45',
  warning: '#c28a22',
  info: '#17668a',
};
const SEVERITY_RANK = { critical: 0, error: 1, warning: 2, info: 3 };

function clockLabel(value, span = 0) {
  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit', hour12: false,
    ...(span <= 60_000 ? { second: '2-digit' } : {}),
    ...(span < 6000 ? { fractionalSecondDigits: 3 } : {}),
  });
}

function fullTimestamp(value) {
  return Number.isFinite(epochOf(value)) ? new Date(value).toLocaleString([], { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3, hour12: false }) : 'Timestamp unavailable';
}

function severityClass(severity) {
  return `analysis-workspace__severity--${severity || 'info'}`;
}

export default function EvidenceTimeline({ events, evidenceRanges = [], investigationWindow = null, incidentAt = null, onInvestigationWindowChange, severityFilter, onSeverityChange }) {
  const [viewport, setViewport] = useState(null);
  const [focusedKey, setFocusedKey] = useState(null);
  const [dragDomain, setDragDomain] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const svgRef = useRef(null);
  const dragRef = useRef(null);

  const filteredEvents = useMemo(() => events
    .map((event, index) => ({
      ...event,
      key: `${event.jobId}:${event.pluginId}:${index}:${event.evidence?.sourceLine ?? event.evidence?.packetNumber ?? ''}`,
      epoch: event.timestamp ? Date.parse(event.timestamp) : NaN,
    }))
    .filter((event) => (severityFilter === 'all' || event.severity === severityFilter)
      && matchesTimelineSearch(event, searchQuery)), [events, severityFilter, searchQuery]);

  const timedEvents = useMemo(() => filteredEvents
    .filter((event) => Number.isFinite(event.epoch))
    .sort((left, right) => left.epoch - right.epoch), [filteredEvents]);
  const untimedEvents = filteredEvents.filter(event => !Number.isFinite(event.epoch));

  const sampleRanges = evidenceRanges.map((item) => ({
    start: epochOf(item.start_time), end: epochOf(item.end_time),
    key: item.job_id, name: item.artifact_name,
  }));
  const windowStart = epochOf(investigationWindow?.start);
  const windowEnd = epochOf(investigationWindow?.end);
  const incidentEpoch = epochOf(incidentAt);
  const extent = [
    ...events.map((event) => epochOf(event.timestamp)),
    ...sampleRanges.flatMap((range) => [range.start, range.end]),
    windowStart, windowEnd, incidentEpoch,
  ].filter(Number.isFinite);
  const firstEpoch = extent.length ? Math.min(...extent) : 0;
  const lastEpoch = extent.length ? Math.max(...extent) : firstEpoch;
  const calculatedSpan = Math.max(lastEpoch - firstEpoch, 60_000);
  const calculatedMin = (firstEpoch + lastEpoch - calculatedSpan) / 2;
  const fitWindow = () => {
    if (!Number.isFinite(windowStart) || !Number.isFinite(windowEnd) || windowEnd <= windowStart) return;
    const span = Math.min(calculatedSpan, Math.max(1, (windowEnd - windowStart) * 1.4));
    const start = Math.max(calculatedMin, Math.min(calculatedMin + calculatedSpan - span, (windowStart + windowEnd - span) / 2));
    setViewport({ start, span });
  };
  useEffect(() => {
    if (!dragRef.current) fitWindow();
  }, [windowStart, windowEnd, Boolean(dragDomain)]);
  const domain = dragDomain || {
    dataSpan: calculatedSpan,
    minEpoch: calculatedMin,
    ...resolveTimelineViewport(viewport, calculatedMin, calculatedSpan),
  };
  const { dataSpan, minEpoch, visibleSpan, visibleStart, visibleEnd } = domain;
  const maxZoom = dataSpan;
  const zoom = dataSpan / visibleSpan;
  const setZoom = (change) => {
    const nextZoom = typeof change === 'function' ? change(zoom) : change;
    const span = Math.max(1, dataSpan / nextZoom);
    setViewport({ start: (visibleStart + visibleEnd - span) / 2, span });
  };
  const setPan = (percentage) => setViewport({
    start: minEpoch + (dataSpan - visibleSpan) * percentage / 100,
    span: visibleSpan,
  });
  const domainSpan = Math.max(visibleEnd - visibleStart, 1);
  const xFor = (epoch) => LEFT + ((epoch - visibleStart) / domainSpan) * (RIGHT - LEFT);
  const visibleEvents = timedEvents.filter((event) => event.epoch >= visibleStart && event.epoch <= visibleEnd);
  const clippedWindow = clipInterval(windowStart, windowEnd, visibleStart, visibleEnd);
  const editableWindow = clippedWindow && typeof onInvestigationWindowChange === 'function';

  const beginWindowDrag = (event, mode) => {
    if (!editableWindow || dragRef.current || !event.isPrimary || event.button !== 0) return;
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM();
    if (!matrix) return;
    const inverse = matrix.inverse();
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus();
    svg.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      mode,
      inverse,
      originX: inverse.a * event.clientX + inverse.c * event.clientY + inverse.e,
      window: { start: windowStart, end: windowEnd },
      domain: { ...domain },
    };
    setDragDomain({ ...domain });
  };
  const moveWindowDrag = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const mappedX = drag.inverse.a * event.clientX + drag.inverse.c * event.clientY + drag.inverse.e;
    const delta = (mappedX - drag.originX) / (RIGHT - LEFT) * (drag.domain.visibleEnd - drag.domain.visibleStart);
    const next = adjustInvestigationWindow(drag.window, drag.mode, delta);
    if (next) onInvestigationWindowChange(next);
  };
  const endWindowDrag = (event) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragDomain(null);
    if (svgRef.current?.hasPointerCapture(event.pointerId)) svgRef.current.releasePointerCapture(event.pointerId);
  };
  const windowKeyDown = (event, mode) => {
    if (dragRef.current || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const direction = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : -1;
    const step = Math.max(1, Math.round(domainSpan / (RIGHT - LEFT))) * (event.shiftKey ? 10 : 1);
    const next = adjustInvestigationWindow({ start: windowStart, end: windowEnd }, mode, direction * step);
    if (next) onInvestigationWindowChange(next);
  };
  const windowControlProps = (mode) => ({
    role: 'slider',
    tabIndex: 0,
    'aria-label': mode === 'move' ? 'Move investigation window' : mode === 'start' ? 'Resize investigation window start' : 'Resize investigation window end',
    'aria-orientation': 'horizontal',
    'aria-valuemin': mode === 'end' ? windowStart + 1 : -8_640_000_000_000_000,
    'aria-valuemax': mode === 'start' ? windowEnd - 1 : 8_640_000_000_000_000 - (mode === 'move' ? windowEnd - windowStart : 0),
    'aria-valuenow': mode === 'end' ? windowEnd : windowStart,
    'aria-valuetext': mode === 'move' ? `${fullTimestamp(windowStart)} to ${fullTimestamp(windowEnd)}` : fullTimestamp(mode === 'start' ? windowStart : windowEnd),
    onPointerDown: (event) => beginWindowDrag(event, mode),
    onKeyDown: (event) => windowKeyDown(event, mode),
  });

  const groups = clusterTimelineEvents(visibleEvents, xFor);
  const layout = groups.map((group, index) => {
    const representative = [...group.events].sort((left, right) => (SEVERITY_RANK[left.severity] ?? 3) - (SEVERITY_RANK[right.severity] ?? 3))[0];
    return { ...representative, x: group.x, side: index % 2 === 0 ? 'top' : 'bottom', lane: 0, members: group.events };
  });

  const selected = filteredEvents.find((event) => event.key === focusedKey)
    || filteredEvents.find((event) => event.severity === 'critical')
    || filteredEvents.find((event) => event.severity === 'error')
    || filteredEvents[0]
    || null;
  const focusRadius = Math.max(0.5, visibleSpan * 0.07);
  const selectedGroup = groups.find(group => group.events.some(event => event.key === selected?.key));
  const targetStep = domainSpan / 6;
  const magnitude = 10 ** Math.floor(Math.log10(targetStep));
  const majorStep = [1, 2, 5, 10].map((factor) => factor * magnitude).find((step) => step >= targetStep);
  const minorStep = majorStep / 5;
  const tickValues = Array.from({ length: Math.ceil(domainSpan / majorStep) + 1 }, (_, index) => Math.ceil(visibleStart / majorStep) * majorStep + index * majorStep).filter((tick) => tick <= visibleEnd);
  const minorTicks = Array.from({ length: Math.ceil(domainSpan / minorStep) + 1 }, (_, index) => Math.ceil(visibleStart / minorStep) * minorStep + index * minorStep).filter((tick) => tick <= visibleEnd);
  const renderRange = (start, end, y, height, kind, key, title) => {
    const clipped = clipInterval(start, end, visibleStart, visibleEnd);
    if (!clipped) return null;
    const className = `analysis-timeline__window analysis-timeline__window--${kind}`;
    return clipped.start === clipped.end
      ? <line key={key} x1={xFor(clipped.start)} x2={xFor(clipped.start)} y1={y} y2={y + height} className={className}><title>{title}</title></line>
      : <rect key={key} x={xFor(clipped.start)} y={y} width={xFor(clipped.end) - xFor(clipped.start)} height={height} rx="3" className={className}><title>{title}</title></rect>;
  };

  return <section className="analysis-timeline" aria-label="Cross-plugin evidence timeline">
    <div className="analysis-timeline__controls">
      <div className="analysis-timeline__search">
        <label>Search events<input type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Process, host, summary, or file" /></label>
        <button type="button" className="icon-button" title="Clear event search" aria-label="Clear event search" disabled={!searchQuery} onClick={() => setSearchQuery('')}><X size={16} /></button>
        <span role="status">{filteredEvents.length} / {events.length} preview events match; {visibleEvents.length} in view</span>
      </div>
      <button type="button" className="admin-secondary-button" onClick={fitWindow} disabled={Boolean(dragDomain) || !Number.isFinite(windowStart) || !Number.isFinite(windowEnd)}>Fit investigation window</button>
      <label className="analysis-timeline__filter">Severity<select value={severityFilter} onChange={(event) => onSeverityChange(event.target.value)}><option value="all">All severities</option><option value="critical">Critical</option><option value="error">Error</option><option value="warning">Warning</option><option value="info">Info</option></select></label>
      <div className="analysis-timeline__zoom"><span className="analysis-timeline__timezone">Times shown in {Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time'}</span><button type="button" aria-label="Zoom out" title="Zoom out" disabled={Boolean(dragDomain) || zoom <= 1} onClick={() => setZoom((value) => Math.max(1, value / 2))}><ZoomOut size={16} /></button><label>Visible span (ms)<input type="number" min="1" max={dataSpan} step="1" value={Math.round(visibleSpan)} disabled={Boolean(dragDomain)} onChange={(event) => { const span = Number(event.target.value); if (Number.isFinite(span) && span >= 1) setZoom(dataSpan / Math.min(dataSpan, span)); }} aria-label="Visible timeline span in milliseconds" /></label><button type="button" aria-label="Zoom in" title="Zoom in" disabled={Boolean(dragDomain) || zoom >= maxZoom} onClick={() => setZoom((value) => Math.min(maxZoom, value * 2))}><ZoomIn size={16} /></button></div>
    </div>
    {visibleSpan < dataSpan && <label className="analysis-timeline__pan">Visible start (local)<input type="datetime-local" step="0.001" value={toLocalDateTime(visibleStart)} disabled={Boolean(dragDomain)} onChange={(event) => { const start = epochOf(toOffsetISOString(event.target.value)); if (Number.isFinite(start)) setPan(Math.max(0, Math.min(100, (start - minEpoch) / (dataSpan - visibleSpan) * 100))); }} aria-label="Visible timeline start in local time" /></label>}
    {extent.length ? <div className="analysis-timeline__canvas"><svg ref={svgRef} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="group" aria-label={`Timeline showing ${visibleEvents.length} timestamped events, selected sampled ranges, investigation window and incident`} onPointerMove={moveWindowDrag} onPointerUp={endWindowDrag} onPointerCancel={endWindowDrag} onLostPointerCapture={endWindowDrag}>
      {renderRange(windowStart, windowEnd, 112, 154, 'investigation', 'investigation', `Investigation window: ${fullTimestamp(investigationWindow?.start)} to ${fullTimestamp(investigationWindow?.end)}`)}
      {sampleRanges.map((range) => renderRange(range.start, range.end, 139, 102, 'evidence', range.key, `${range.name}: sampled range ${fullTimestamp(range.start)} to ${fullTimestamp(range.end)}`))}
      {Number.isFinite(selected?.epoch) && renderRange(selected.epoch - focusRadius, selected.epoch + focusRadius, 124, 132, 'focus', 'focus', 'Selected event focus')}
      {tickValues.map((tick, index) => <g key={index} className="analysis-timeline__tick"><line x1={xFor(tick)} y1="164" x2={xFor(tick)} y2="239" /><text x={xFor(tick)} y="267" textAnchor="middle">{clockLabel(tick, domainSpan)}</text></g>)}
      <rect x={LEFT} y={AXIS_Y - 10} width={RIGHT - LEFT} height="20" rx="3" className="analysis-timeline__pipe" />
      {minorTicks.map((tick, index) => <line key={index} x1={xFor(tick)} x2={xFor(tick)} y1={AXIS_Y - 15} y2={AXIS_Y + 15} className="analysis-timeline__pipe-tick" />)}
      {layout.map((event) => {
        const color = SEVERITY_COLOR[event.severity] || SEVERITY_COLOR.info;
        const top = event.side === 'top';
        const labelY = top ? 45 + event.lane * 27 : 293 + event.lane * 26;
        const branchY = top ? labelY + 27 : labelY - 20;
        const active = event.members.some(member => member.key === selected?.key);
        const label = event.members.length > 1 ? `${event.members.length} nearby events` : event.summary;
        return <g key={event.key} className="analysis-timeline__event" role="button" tabIndex="0" aria-label={`${event.severity}: ${label}`} onClick={() => setFocusedKey(event.key)} onKeyDown={(keyEvent) => { if (keyEvent.key === 'Enter' || keyEvent.key === ' ') { keyEvent.preventDefault(); setFocusedKey(event.key); } }}>
          <title>{`${fullTimestamp(event.timestamp)} · ${event.pluginId} · ${event.summary}`}</title>
          <line x1={event.x} y1={top ? AXIS_Y - 10 : AXIS_Y + 10} x2={event.x} y2={branchY} stroke={color} className="analysis-timeline__branch" />
          <circle cx={event.x} cy={AXIS_Y} r={active ? 8 : 5} fill={color} className="analysis-timeline__marker" />
          <text x={Math.max(170, Math.min(1030, event.x))} y={labelY} textAnchor="middle" className={`analysis-timeline__event-label${active ? ' analysis-timeline__event-label--active' : ''}`} fill={color}>{label.slice(0, 28)}{label.length > 28 ? '…' : ''}</text>
          <text x={Math.max(170, Math.min(1030, event.x))} y={labelY + (top ? 15 : 16)} textAnchor="middle" className="analysis-timeline__event-source">{event.members.length > 1 ? `${new Set(event.members.map(member => member.pluginId)).size} source plugins` : event.pluginId}</text>
          <text x={event.x} y={labelY + (top ? 27 : 28)} textAnchor="middle" className="analysis-timeline__event-time">{clockLabel(event.epoch)}</text>
        </g>;
      })}
      {Number.isFinite(incidentEpoch) && incidentEpoch >= visibleStart && incidentEpoch <= visibleEnd && <g className="analysis-timeline__incident"><title>{`Incident: ${fullTimestamp(incidentAt)}`}</title><line x1={xFor(incidentEpoch)} x2={xFor(incidentEpoch)} y1="28" y2="253" /><text x={xFor(incidentEpoch)} y="20" textAnchor={xFor(incidentEpoch) > (LEFT + RIGHT) / 2 ? 'end' : 'start'}>Incident</text></g>}
      {editableWindow && <g className="analysis-timeline__window-editor">
        <rect {...windowControlProps('move')} className="analysis-timeline__window-move" x={xFor(clippedWindow.start)} y="112" width={Math.max(1, xFor(clippedWindow.end) - xFor(clippedWindow.start))} height="24">
          <title>Move investigation window</title>
        </rect>
        {['start', 'end'].map((edge) => {
          const epoch = edge === 'start' ? windowStart : windowEnd;
          if (epoch < visibleStart || epoch > visibleEnd) return null;
          const position = xFor(epoch);
          return <g key={edge} {...windowControlProps(edge)} className="analysis-timeline__window-handle">
            <title>{edge === 'start' ? 'Resize investigation window start' : 'Resize investigation window end'}</title>
            <rect className="analysis-timeline__window-hit" x={edge === 'start' ? position - 20 : position} y="112" width="20" height="24" />
            <rect className="analysis-timeline__window-grip" x={position - 3} y="112" width="6" height="24" rx="2" />
          </g>;
        })}
      </g>}
    </svg></div> : <p className="analysis-workspace__empty">Select evidence with timestamped events to plot a timeline.</p>}
    {selectedGroup?.events.length > 1 && <section className="analysis-timeline__cluster-list" aria-label="Nearby events">
      <h4>{selectedGroup.events.length} nearby events</h4>
      {selectedGroup.events.map(event => <button key={event.key} type="button" aria-pressed={selected?.key === event.key} onClick={() => setFocusedKey(event.key)}>
        <time>{clockLabel(event.epoch)}</time><span>{event.severity} · {event.pluginId}</span><strong>{event.summary}</strong>
      </button>)}
    </section>}
    {untimedEvents.length > 0 && <section className="analysis-timeline__cluster-list" aria-label="Events without timestamps">
      <h4>Events without timestamps ({untimedEvents.length})</h4>
      {untimedEvents.map(event => <button key={event.key} type="button" aria-pressed={selected?.key === event.key} onClick={() => setFocusedKey(event.key)}>
        <span>Time unavailable</span><span>{event.severity} · {event.pluginId}</span><strong>{event.summary}</strong>
      </button>)}
    </section>}
    <div className="analysis-timeline__legend"><span><i className="analysis-timeline__legend-swatch analysis-timeline__legend-swatch--evidence" /> Sampled evidence ranges</span><span><i className="analysis-timeline__legend-swatch analysis-timeline__legend-swatch--focus" /> Selected event focus</span>{investigationWindow && <span><i className="analysis-timeline__legend-swatch analysis-timeline__legend-swatch--investigation" /> Investigation window</span>}{Number.isFinite(incidentEpoch) && <span><i className="analysis-timeline__legend-swatch analysis-timeline__legend-swatch--incident" /> Incident · {fullTimestamp(incidentAt)}</span>}<span>Sampled preview only, not full-file coverage.</span>{sampleRanges.some((range) => !Number.isFinite(range.start) || !Number.isFinite(range.end) || range.start > range.end) && <span>Some sampled ranges are unavailable</span>}{filteredEvents.length !== timedEvents.length && <span>{filteredEvents.length - timedEvents.length} events lack timestamps</span>}</div>
    {selected && <article className="analysis-timeline__inspector"><div><p className="eyebrow">Selected event · {selected.pluginId}</p><h5>{selected.summary}</h5></div><span className={`analysis-workspace__severity ${severityClass(selected.severity)}`}>{selected.severity}</span><p>{fullTimestamp(selected.timestamp)} · {selected.artifactName}{selected.evidence?.sourceLine ? ` · line ${selected.evidence.sourceLine}` : ''}{selected.evidence?.packetNumber ? ` · packet ${selected.evidence.packetNumber}` : ''}</p></article>}
  </section>;
}
