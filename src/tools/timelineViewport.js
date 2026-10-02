export function resolveTimelineViewport(viewport, minEpoch, dataSpan) {
  const start = viewport?.start ?? minEpoch;
  const span = viewport?.span ?? dataSpan;
  return { visibleStart: start, visibleEnd: start + span, visibleSpan: span };
}