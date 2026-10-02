import { useMemo, useState } from 'react';
import { ZoomIn, ZoomOut } from 'lucide-react';
import { clipInterval, epochOf, toLocalDateTime, toOffsetISOString } from './investigationTime';

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
    ...(span < 60_000 ? { second: '2-digit' } : {}),
    ...(span < 1000 ? { fractionalSecondDigits: 3 } : {}),
  });
}

function fullTimestamp(value) {
  return value ? new Date(value).toLocaleString([], { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3, hour12: false }) : 'Timestamp unavailable';
}

function severityClass(severity) {
  return `analysis-workspace__severity--${severity || 'info'}`;
}

export default function EvidenceTimeline({ events, evidenceRanges = [], investigationWindow = null, incidentAt = null, severityFilter, onSeverityChange }) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState(50);
  const [focusedKey, setFocusedKey] = useState(null);

  const filteredEvents = useMemo(() => events
    .filter((event) => severityFilter === 'all' || event.severity === severityFilter)
    .map((event, index) => ({
      ...event,
      key: `${event.jobId}:${event.pluginId}:${index}:${event.evidence?.sourceLine ?? event.evidence?.packetNumber ?? ''}`,
      epoch: event.timestamp ? Date.parse(event.timestamp) : NaN,
    })), [events, severityFilter]);

  const timedEvents = useMemo(() => filteredEvents
    .filter((event) => Number.isFinite(event.epoch))
    .sort((left, right) => left.epoch - right.epoch), [filteredEvents]);

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
  const dataSpan = Math.max(lastEpoch - firstEpoch, 60_000);
  const minEpoch = (firstEpoch + lastEpoch - dataSpan) / 2;
  const maxEpoch = minEpoch + dataSpan;
  const maxZoom = dataSpan;
  const visibleSpan = Math.max(dataSpan / Math.min(zoom, maxZoom), 1);
  const center = minEpoch + visibleSpan / 2 + (dataSpan - visibleSpan) * (pan / 100);
  const visibleStart = Math.max(minEpoch, center - visibleSpan / 2);
  const visibleEnd = Math.min(maxEpoch, center + visibleSpan / 2);
  const domainSpan = Math.max(visibleEnd - visibleStart, 1);
  const xFor = (epoch) => LEFT + ((epoch - visibleStart) / domainSpan) * (RIGHT - LEFT);
  const visibleEvents = timedEvents.filter((event) => event.epoch >= visibleStart && event.epoch <= visibleEnd);

  const layout = [];
  const lanes = { top: [-Infinity, -Infinity, -Infinity, -Infinity], bottom: [-Infinity, -Infinity, -Infinity, -Infinity] };
  visibleEvents.forEach((event, index) => {
    const x = xFor(event.epoch);
    const side = index % 2 === 0 ? 'top' : 'bottom';
    let lane = lanes[side].findIndex((lastX) => x - lastX >= 126);
    if (lane < 0) lane = lanes[side].indexOf(Math.min(...lanes[side]));
    lanes[side][lane] = x;
    layout.push({ ...event, x, side, lane });
  });

  const selected = filteredEvents.find((event) => event.key === focusedKey)
    || filteredEvents.find((event) => event.severity === 'critical')
    || filteredEvents.find((event) => event.severity === 'error')
    || filteredEvents[0]
    || null;
  const focusRadius = Math.max(0.5, visibleSpan * 0.07);
  const tickValues = Array.from({ length: 7 }, (_, index) => visibleStart + domainSpan * index / 6);
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
      <label className="analysis-timeline__filter">Severity<select value={severityFilter} onChange={(event) => onSeverityChange(event.target.value)}><option value="all">All severities</option><option value="critical">Critical</option><option value="error">Error</option><option value="warning">Warning</option><option value="info">Info</option></select></label>
      <div className="analysis-timeline__zoom"><span className="analysis-timeline__timezone">Times shown in {Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time'}</span><button type="button" aria-label="Zoom out" title="Zoom out" disabled={zoom <= 1} onClick={() => setZoom((value) => Math.max(1, value / 2))}><ZoomOut size={16} /></button><label>Visible span (ms)<input type="number" min="1" max={dataSpan} step="1" value={Math.round(visibleSpan)} onChange={(event) => { const span = Number(event.target.value); if (Number.isFinite(span) && span >= 1) setZoom(dataSpan / Math.min(dataSpan, span)); }} aria-label="Visible timeline span in milliseconds" /></label><button type="button" aria-label="Zoom in" title="Zoom in" disabled={zoom >= maxZoom} onClick={() => setZoom((value) => Math.min(maxZoom, value * 2))}><ZoomIn size={16} /></button></div>
    </div>
    {visibleSpan < dataSpan && <label className="analysis-timeline__pan">Visible start (local)<input type="datetime-local" step="0.001" value={toLocalDateTime(visibleStart)} onChange={(event) => { const start = epochOf(toOffsetISOString(event.target.value)); if (Number.isFinite(start)) setPan(Math.max(0, Math.min(100, (start - minEpoch) / (dataSpan - visibleSpan) * 100))); }} aria-label="Visible timeline start in local time" /></label>}
    {extent.length ? <div className="analysis-timeline__canvas"><svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`Timeline showing ${visibleEvents.length} timestamped events, selected sampled ranges, investigation window and incident`}>
      {renderRange(windowStart, windowEnd, 112, 154, 'investigation', 'investigation', `Investigation window: ${fullTimestamp(investigationWindow?.start)} to ${fullTimestamp(investigationWindow?.end)}`)}
      {sampleRanges.map((range) => renderRange(range.start, range.end, 139, 102, 'evidence', range.key, `${range.name}: sampled range ${fullTimestamp(range.start)} to ${fullTimestamp(range.end)}`))}
      {Number.isFinite(selected?.epoch) && renderRange(selected.epoch - focusRadius, selected.epoch + focusRadius, 124, 132, 'focus', 'focus', 'Selected event focus')}
      {tickValues.map((tick, index) => <g key={index} className="analysis-timeline__tick"><line x1={xFor(tick)} y1="164" x2={xFor(tick)} y2="239" /><text x={xFor(tick)} y="267" textAnchor="middle">{clockLabel(tick, domainSpan)}</text></g>)}
      <rect x={LEFT} y={AXIS_Y - 10} width={RIGHT - LEFT} height="20" rx="3" className="analysis-timeline__pipe" />
      {Array.from({ length: 25 }, (_, index) => { const x = LEFT + (RIGHT - LEFT) * index / 24; return <line key={index} x1={x} y1={index % 3 === 0 ? AXIS_Y - 24 : AXIS_Y - 15} x2={x} y2={index % 3 === 0 ? AXIS_Y + 24 : AXIS_Y + 15} className="analysis-timeline__pipe-tick" />; })}
      {layout.map((event) => {
        const color = SEVERITY_COLOR[event.severity] || SEVERITY_COLOR.info;
        const top = event.side === 'top';
        const labelY = top ? 45 + event.lane * 27 : 293 + event.lane * 26;
        const branchY = top ? labelY + 27 : labelY - 20;
        const active = selected?.key === event.key;
        return <g key={event.key} className="analysis-timeline__event" role="button" tabIndex="0" aria-label={`${event.severity}: ${event.summary}`} onClick={() => setFocusedKey(event.key)} onKeyDown={(keyEvent) => { if (keyEvent.key === 'Enter' || keyEvent.key === ' ') { keyEvent.preventDefault(); setFocusedKey(event.key); } }}>
          <title>{`${fullTimestamp(event.timestamp)} · ${event.pluginId} · ${event.summary}`}</title>
          <line x1={event.x} y1={top ? AXIS_Y - 10 : AXIS_Y + 10} x2={event.x} y2={branchY} stroke={color} className="analysis-timeline__branch" />
          <circle cx={event.x} cy={AXIS_Y} r={active ? 8 : 5} fill={color} className="analysis-timeline__marker" />
          <text x={event.x} y={labelY} textAnchor="middle" className={`analysis-timeline__event-label${active ? ' analysis-timeline__event-label--active' : ''}`} fill={color}>{event.summary.slice(0, 28)}{event.summary.length > 28 ? '…' : ''}</text>
          <text x={event.x} y={labelY + (top ? 15 : 16)} textAnchor="middle" className="analysis-timeline__event-source">{event.pluginId}</text>
          <text x={event.x} y={labelY + (top ? 27 : 28)} textAnchor="middle" className="analysis-timeline__event-time">{clockLabel(event.epoch)}</text>
        </g>;
      })}
      {Number.isFinite(incidentEpoch) && incidentEpoch >= visibleStart && incidentEpoch <= visibleEnd && <g className="analysis-timeline__incident"><title>{`Incident: ${fullTimestamp(incidentAt)}`}</title><line x1={xFor(incidentEpoch)} x2={xFor(incidentEpoch)} y1="28" y2="253" /><text x={xFor(incidentEpoch)} y="20" textAnchor={xFor(incidentEpoch) > (LEFT + RIGHT) / 2 ? 'end' : 'start'}>Incident</text></g>}
    </svg></div> : <p className="analysis-workspace__empty">Select evidence with timestamped events to plot a timeline.</p>}
    <div className="analysis-timeline__legend"><span><i className="analysis-timeline__legend-swatch analysis-timeline__legend-swatch--evidence" /> Sampled evidence ranges</span><span><i className="analysis-timeline__legend-swatch analysis-timeline__legend-swatch--focus" /> Selected event focus</span>{investigationWindow && <span><i className="analysis-timeline__legend-swatch analysis-timeline__legend-swatch--investigation" /> Fixed investigation window</span>}{Number.isFinite(incidentEpoch) && <span><i className="analysis-timeline__legend-swatch analysis-timeline__legend-swatch--incident" /> Incident · {fullTimestamp(incidentAt)}</span>}<span>Sampled preview only, not full-file coverage.</span>{sampleRanges.some((range) => !Number.isFinite(range.start) || !Number.isFinite(range.end) || range.start > range.end) && <span>Some sampled ranges are unavailable</span>}{filteredEvents.length !== timedEvents.length && <span>{filteredEvents.length - timedEvents.length} events lack timestamps</span>}</div>
    {selected && <article className="analysis-timeline__inspector"><div><p className="eyebrow">Selected event · {selected.pluginId}</p><h5>{selected.summary}</h5></div><span className={`analysis-workspace__severity ${severityClass(selected.severity)}`}>{selected.severity}</span><p>{fullTimestamp(selected.timestamp)} · {selected.artifactName}{selected.evidence?.sourceLine ? ` · line ${selected.evidence.sourceLine}` : ''}{selected.evidence?.packetNumber ? ` · packet ${selected.evidence.packetNumber}` : ''}</p></article>}
  </section>;
}
