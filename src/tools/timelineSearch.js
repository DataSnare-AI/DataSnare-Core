export function matchesTimelineSearch(event, query) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const text = [event.summary, event.host, event.process, event.category,
    event.pluginId, event.artifactName, event.evidence?.sourceFile,
    event.evidence?.sourceLine, event.evidence?.packetNumber]
    .filter(value => value !== undefined && value !== null)
    .join(' ').toLowerCase();
  return terms.every(term => text.includes(term));
}