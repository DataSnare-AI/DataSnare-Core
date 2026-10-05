import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/styles.css';
import AINetScopeWorkbench from '../../src/tools/AINetScopeWorkbench';

function Fixture() {
  const [selectedJobId, setSelectedJobId] = useState('');
  return <main className="app-shell skin-light">
    <AINetScopeWorkbench selectedTenantId="7" onJobCompleted={async jobId => setSelectedJobId(jobId)} />
    <output aria-label="Imported evidence job">Selected evidence job: {selectedJobId}</output>
  </main>;
}

createRoot(document.getElementById('root')).render(<Fixture />);