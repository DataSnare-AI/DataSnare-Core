import { useState } from 'react';
import { Download } from 'lucide-react';
import { buildRequestHeaders, readLaunchContext } from '../contracts/session';
import { buildInvestigationExport } from './investigationExport';

export default function ExportInvestigation({ tenantId, investigationId }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const exportCase = async () => {
    setBusy(true);
    setError('');
    try {
      const headers = await buildRequestHeaders(readLaunchContext());
      const response = await fetch(`/api/tenants/${encodeURIComponent(tenantId)}/analysis/investigations/${encodeURIComponent(investigationId)}`, { headers });
      if (!response.ok) throw new Error(`Could not export saved investigation (${response.status}).`);
      const savedCase = await response.json();
      if (String(savedCase.tenant_id) !== String(tenantId) || savedCase.investigation_id !== investigationId) {
        throw new Error('The returned investigation does not match the selected case.');
      }
      const blob = new Blob([JSON.stringify(buildInvestigationExport(savedCase), null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `investigation-${investigationId}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) {
      setError(failure.message || 'Investigation export failed.');
    } finally {
      setBusy(false);
    }
  };
  return <div>
    <button className="admin-secondary-button" type="button" disabled={busy || !tenantId || !investigationId} onClick={exportCase} title="Export the saved snapshot; unsaved edits and original files are not included"><Download size={15} /> {busy ? 'Exporting...' : 'Export saved case'}</button>
    {error && <p className="tool-workbench__error" role="alert">{error}</p>}
  </div>;
}