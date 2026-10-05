import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/styles.css';
import NativeToolWorkbench from '../../src/tools/NativeToolWorkbench';

function Fixture() {
  const [refreshCount, setRefreshCount] = useState(0);
  const [selectedJobId, setSelectedJobId] = useState('');
  return <main className="app-shell skin-light">
    <NativeToolWorkbench
      toolId="airca"
      selectedTenantId="7"
      onJobCompleted={async jobId => {
        setRefreshCount(count => count + 1);
        setSelectedJobId(jobId);
      }}
    />
    <output aria-label="Evidence refresh count">Evidence refreshes: {refreshCount} · Selected {selectedJobId}</output>
  </main>;
}

createRoot(document.getElementById('root')).render(<Fixture />);