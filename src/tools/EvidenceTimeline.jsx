import { useMemo, useState } from 'react';
import { ZoomIn, ZoomOut } from 'lucide-react';

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

function clockLabel(value) {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fullTimestamp(value) {
  return value ? new Date(value).toLocaleString() : 'Timestamp unavailable';
}

function severityClass(severity) {
  return `analysis-workspace__severity--${severity || 'info'}`;
}

export default function EvidenceTimeline({ events, severityFilter, onSeverityChange }) {
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

  const firstEpoch = timedEvents[0]?.epoch ?? 0;
  const lastEpoch = timedEvents.at(-1)?.epoch ?? firstEpoch;
  const dataSpan = Math.max(lastEpoch - firstEpoch, 60_000);
  const minEpoch = (firstEpoch + lastEpoch - dataSpan) / 2;
  const maxEpoch = minEpoch + dataSpan;
  const visibleSpan = Math.max(dataSpan / zoom, 60_000);
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
  const focusRadius = Math.max(30_000, visibleSpan * 0.07);
  const focusStart = selected?.timestamp ? Math.max(visibleStart, selected.epoch - focusRadius) : visibleStart;
  const focusEnd = selected?.timestamp ? Math.min(visibleEnd, selected.epoch + focusRadius) : visibleEnd;
  const evidenceStart = Math.max(visibleStart, minEpoch);
  const evidenceEnd = Math.min(visibleEnd, maxEpoch);
  const tickValues = Array.from({ length: 7 }, (_, index) => visibleStart + domainSpan * index / 6);

  return <section className="analysis-timeline" aria-label="Cross-plugin evidence timeline">
    <div className="analysis-timeline__controls">
      <label className="analysis-timeline__filter">Severity<select value={severityFilter} onChange={(event) => onSeverityChange(event.target.value)}><option value="all">All severities</option><option value="critical">Critical</option><option value="error">Error</option><option value="warning">Warning</option><option value="info">Info</option></select></label>
      <div className="analysis-timeline__zoom"><span className="analysis-timeline__timezone">Times shown in {Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time'}</span><button type="button" aria-label="Zoom out" title="Zoom out" disabled={zoom <= 1} onClick={() => setZoom((value) => Math.max(1, value / 1.5))}><ZoomOut size={16} /></button><label>Zoom {zoom.toFixed(1)}×<input type="range" min="1" max="12" step="0.5" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} aria-label="Timeline zoom" /></label><button type="button" aria-label="Zoom in" title="Zoom in" disabled={zoom >= 12} onClick={() => setZoom((value) => Math.min(12, value * 1.5))}><ZoomIn size={16} /></button></div>
    </div>
    {zoom > 1 && <label className="analysis-timeline__pan">Time window position<input type="range" min="0" max="100" value={pan} onChange={(event) => setPan(Number(event.target.value))} aria-label="Timeline window position" /></label>}
    {timedEvents.length ? <div className="analysis-timeline__canvas"><svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`Timeline showing ${visibleEvents.length} timestamped events`}>
      <rect x={xFor(evidenceStart)} y="139" width={Math.max(0, xFor(evidenceEnd) - xFor(evidenceStart))} height="102" rx="3" className="analysis-timeline__window analysis-timeline__window--evidence" />
      {selected?.timestamp && <rect x={xFor(focusStart)} y="124" width={Math.max(2, xFor(focusEnd) - xFor(focusStart))} height="132" rx="3" className="analysis-timeline__window analysis-timeline__window--focus" />}
      {tickValues.map((tick, index) => <g key={index} className="analysis-timeline__tick"><line x1={xFor(tick)} y1="164" x2={xFor(tick)} y2="239" /><text x={xFor(tick)} y="267" textAnchor="middle">{clockLabel(tick)}</text></g>)}
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
    </svg></div> : <p className="analysis-workspace__empty">Select evidence with timestamped events to plot a timeline.</p>}
    <div className="analysis-timeline__legend"><span><i className="analysis-timeline__legend-swatch analysis-timeline__legend-swatch--evidence" /> Evidence range</span><span><i className="analysis-timeline__legend-swatch analysis-timeline__legend-swatch--focus" /> Focus window</span><span>Sampled preview only; artifact totals are shown above.</span>{filteredEvents.length !== timedEvents.length && <span>{filteredEvents.length - timedEvents.length} events lack timestamps</span>}</div>
    {selected && <article className="analysis-timeline__inspector"><div><p className="eyebrow">Selected event · {selected.pluginId}</p><h5>{selected.summary}</h5></div><span className={`analysis-workspace__severity ${severityClass(selected.severity)}`}>{selected.severity}</span><p>{fullTimestamp(selected.timestamp)} · {selected.artifactName}{selected.evidence?.sourceLine ? ` · line ${selected.evidence.sourceLine}` : ''}{selected.evidence?.packetNumber ? ` · packet ${selected.evidence.packetNumber}` : ''}</p></article>}
  </section>;
}
