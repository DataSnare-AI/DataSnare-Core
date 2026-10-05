import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import EvidenceTimeline from '../../src/tools/EvidenceTimeline';

const origin = Date.parse('2026-10-02T22:17:22.000Z');
const timestamp = offset => new Date(origin + offset).toISOString();
const firstEvent = { jobId: 'first', pluginId: 'ainetscope', timestamp: timestamp(500), severity: 'warning', summary: 'First trace packet' };
const secondEvent = { jobId: 'second', pluginId: 'ainetscope', timestamp: timestamp(70000), severity: 'info', summary: 'Distant trace packet' };
const firstRange = { job_id: 'first', artifact_name: 'first.pcap', start_time: timestamp(0), end_time: timestamp(1000) };
const secondRange = { job_id: 'second', artifact_name: 'second.pcap', start_time: timestamp(69000), end_time: timestamp(71000) };

function Fixture() {
  const [extended, setExtended] = useState(false);
  const [window, setWindow] = useState({ start: origin + 300, end: origin + 700 });
  return <main>
    <button onClick={() => setExtended(true)}>Add distant trace</button>
    <button onClick={() => setExtended(false)}>Remove distant trace</button>
    <EvidenceTimeline
      events={extended ? [firstEvent, secondEvent] : [firstEvent]}
      evidenceRanges={extended ? [firstRange, secondRange] : [firstRange]}
      investigationWindow={window}
      incidentAt={timestamp(500)}
      onInvestigationWindowChange={setWindow}
      severityFilter="all"
      onSeverityChange={() => {}}
    />
  </main>;
}

createRoot(document.getElementById('root')).render(<Fixture />);