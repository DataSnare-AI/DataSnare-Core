export function epochOf(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  return typeof value === 'string' && value.trim() ? Date.parse(value) : NaN;
}

const pad = (value, width = 2) => String(value).padStart(width, '0');

export function toLocalDateTime(value) {
  const epoch = epochOf(value);
  if (!Number.isFinite(epoch)) return '';
  const date = new Date(epoch);
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

export function toOffsetISOString(value) {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value || '');
  if (!match) return null;
  const normalized = `${match[1]}:${match[2] || '00'}.${(match[3] || '').padEnd(3, '0')}`;
  const date = new Date(normalized);
  if (toLocalDateTime(date.getTime()) !== normalized) return null;
  const offset = -date.getTimezoneOffset();
  return `${normalized}${offset < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
}

export function metadataError(fields) {
  if (fields.incident_at && !toOffsetISOString(fields.incident_at)) return 'Enter a valid local incident datetime.';
  if (Boolean(fields.window_start) !== Boolean(fields.window_end)) return 'Enter both investigation window endpoints, or leave both empty.';
  if (fields.window_start) {
    const start = toOffsetISOString(fields.window_start);
    const end = toOffsetISOString(fields.window_end);
    if (!start || !end) return 'Enter valid local investigation window datetimes.';
    if (epochOf(start) > epochOf(end)) return 'Investigation window end must not precede its start.';
  }
  return '';
}

export function buildInvestigationMetadata(fields, workingNote) {
  const error = metadataError(fields);
  if (error) throw new Error(error);
  return {
    working_note: workingNote,
    incident_description: fields.incident_description,
    ...(fields.incident_at ? { incident_at: toOffsetISOString(fields.incident_at) } : {}),
    ...(fields.window_start ? { window_start: toOffsetISOString(fields.window_start), window_end: toOffsetISOString(fields.window_end) } : {}),
  };
}

export function formatGap(milliseconds) {
  let remaining = Math.max(0, Math.round(milliseconds));
  const parts = [];
  for (const [unit, size] of [['d', 86_400_000], ['h', 3_600_000], ['min', 60_000], ['s', 1000], ['ms', 1]]) {
    const amount = Math.floor(remaining / size);
    if (amount) parts.push(`${amount} ${unit}`);
    remaining %= size;
  }
  return parts.join(' ') || '0 ms';
}

export function compareSampleWindow(sample, window) {
  if (!window) return { kind: 'none', text: '' };
  const start = epochOf(sample.start_time);
  const end = epochOf(sample.end_time);
  const windowStart = epochOf(window.start);
  const windowEnd = epochOf(window.end);
  if (![start, end, windowStart, windowEnd].every(Number.isFinite) || start > end || windowStart > windowEnd) {
    return { kind: 'unavailable', text: 'Sample range unavailable; window gap unavailable' };
  }
  if (end < windowStart) {
    const gap = windowStart - end;
    return { kind: 'before', gap, text: `Sample before investigation window; gap ${formatGap(gap)}` };
  }
  if (start > windowEnd) {
    const gap = start - windowEnd;
    return { kind: 'after', gap, text: `Sample after investigation window; gap ${formatGap(gap)}` };
  }
  return start < windowStart || end > windowEnd
    ? { kind: 'partial', text: 'Sample partially overlaps investigation window' }
    : { kind: 'inside', text: 'Sample within investigation window' };
}

export function clipInterval(start, end, visibleStart, visibleEnd) {
  const clippedStart = Math.max(start, visibleStart);
  const clippedEnd = Math.min(end, visibleEnd);
  return [start, end, visibleStart, visibleEnd].every(Number.isFinite) && start <= end && clippedStart <= clippedEnd
    ? { start: clippedStart, end: clippedEnd } : null;
}