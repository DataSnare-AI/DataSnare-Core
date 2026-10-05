import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/styles.css';
import NativeToolWorkbench from '../../src/tools/NativeToolWorkbench';

function Fixture() {
  const [selectedJobId, setSelectedJobId] = useState('');
  const toolId = new URLSearchParams(location.search).get('tool') || 'aiprocmon';
  return <main className="app-shell skin-light">
    <NativeToolWorkbench toolId={toolId} selectedTenantId="7" onJobCompleted={async jobId => setSelectedJobId(jobId)} />
    <output>Selected evidence: {selectedJobId}</output>
  </main>;
}

createRoot(document.getElementById('root')).render(<Fixture />);