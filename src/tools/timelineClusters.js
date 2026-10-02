export function clusterTimelineEvents(events, xFor, distance = 140) {
  const groups = [];
  for (const event of events) {
    const position = xFor(event.epoch);
    const previous = groups.at(-1);
    if (previous && position - previous.firstX < distance) {
      previous.events.push(event);
      previous.x = previous.events.reduce((sum, item) => sum + xFor(item.epoch), 0) / previous.events.length;
    } else {
      groups.push({ firstX: position, x: position, events: [event] });
    }
  }
  return groups;
}