import { useState } from 'react';
import { Activity, ExternalLink, Upload } from 'lucide-react';
import { buildRequestHeaders, readLaunchContext } from '../contracts/session';
import TenantSelect, { useTenantSelection } from './TenantSelect';

export default function AINetScopeWorkbench({ selectedTenantId, profile, token, onJobCompleted } = {}) {
  const selection = useTenantSelection({ profile, token, enabled: selectedTenantId === undefined });
  const tenantId = String(selectedTenantId ?? selection.tenantId);
  return <>{selectedTenantId === undefined && <TenantSelect selection={selection} />}<CaptureWorkbench key={tenantId} tenantId={tenantId} onJobCompleted={onJobCompleted} /></>;
}

function CaptureWorkbench({ tenantId, onJobCompleted }) {
  const [file, setFile] = useState(null);
  const [analysisFile, setAnalysisFile] = useState(null);
  const [job, setJob] = useState(null);
  const [importedAnalysis, setImportedAnalysis] = useState(null);
  const [error, setError] = useState('');
  const [importError, setImportError] = useState('');
  const launchContext = readLaunchContext();
  const context = { ...launchContext, account: { ...launchContext?.account, tenantId } };
  const fullAnalyzerUrl = `/ainetscope/index.html?returnTo=${encodeURIComponent('/aianalysis')}`;

  const submitCapture = async (event) => {
    event.preventDefault();
    if (!file || !tenantId.trim()) return;
    setError('');
    try {
      const headers = await buildRequestHeaders(context, { 'Content-Type': 'application/json' });
      const response = await fetch(`/api/tenants/${encodeURIComponent(tenantId.trim())}/tools/ainetscope/jobs`, {
        method: 'POST', headers, body: JSON.stringify({ artifact_name: file.name, artifact_type: file.name.split('.').pop(), file_size_bytes: file.size }),
      });
      if (!response.ok) throw new Error(`Capture job returned ${response.status}.`);
      const queued = await response.json();
      const uploadHeaders = await buildRequestHeaders(context);
      const uploaded = await fetch(`/api/tenants/${encodeURIComponent(tenantId.trim())}/tools/ainetscope/jobs/${queued.job.job_id}/artifact`, { method: 'POST', headers: uploadHeaders, body: await file.arrayBuffer() });
      if (!uploaded.ok) throw new Error(`Capture upload returned ${uploaded.status}: ${(await uploaded.json()).detail || 'upload failed'}`);
      setJob(await uploaded.json());
      await onJobCompleted?.(queued.job.job_id);
    } catch (submitError) { setError(submitError.message || 'Could not create capture job.'); }
  };

  const importAnalysis = async (event) => {
    event.preventDefault();
    if (!analysisFile || !tenantId.trim()) return;
    setImportError('');
    try {
      const headers = await buildRequestHeaders(context, { 'Content-Type': 'application/json' });
      const base = `/api/tenants/${encodeURIComponent(tenantId.trim())}/tools/ainetscope/jobs`;
      const created = await fetch(base, {
        method: 'POST',
        headers,
        body: JSON.stringify({ artifact_name: analysisFile.name, artifact_type: 'json', file_size_bytes: analysisFile.size }),
      });
      const queued = await created.json();
      if (!created.ok) throw new Error(queued.detail || `Analysis import job returned ${created.status}.`);
      const uploaded = await fetch(`${base}/${queued.job.job_id}/artifact`, {
        method: 'POST',
        headers: await buildRequestHeaders(context),
        body: await analysisFile.arrayBuffer(),
      });
      const result = await uploaded.json();
      if (!uploaded.ok) throw new Error(result.detail || `Analysis import returned ${uploaded.status}.`);
      setImportedAnalysis(result);
      await onJobCompleted?.(queued.job.job_id);
    } catch (importFailure) {
      setImportedAnalysis(null);
      setImportError(importFailure.message || 'Could not import the AINetScope analysis export.');
    }
  };

  return <section className="tool-workbench" aria-labelledby="ainetscope-title">
    <p className="eyebrow">Network evidence</p>
    <h2 id="ainetscope-title">AINetScope</h2>
    <p>Run the full browser analyzer for detailed packet, flow, topology, and protocol inspection. Import its analysis export here to add findings to this tenant investigation.</p>
    <p><a className="admin-secondary-button" href={fullAnalyzerUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} /> Open full AINetScope</a></p>
    <form onSubmit={submitCapture} className="tool-workbench__form">
      <label>Capture file<input type="file" accept=".pcap,.pcapng,.cap" onChange={(event) => setFile(event.target.files?.[0] || null)} /></label>
      <button className="primary-button" type="submit" disabled={!file || !tenantId.trim() || file.size > 250 * 1024 * 1024}><Upload size={16} /> Analyze capture</button>
    </form>
    {error && <p className="tool-workbench__error">{error}</p>}
    {job && <div className="tool-workbench__status"><Activity size={18} /><div><strong>{job.job.artifact_name}</strong><span>{job.job.state} · {job.analysis.packets.toLocaleString()} packets · {job.analysis.flows.toLocaleString()} flows · {job.analysis.hosts.toLocaleString()} hosts</span><small>{job.analysis.message}</small><small>{Object.entries(job.analysis.protocols).map(([protocol, count]) => `${protocol} ${count}`).join(' · ')}</small>{job.analysis.findings.map(finding => <p key={finding.id}>{finding.severity}: {finding.title} · {finding.detail}</p>)}{job.analysis.preview.slice(0, 8).map(packet => <p key={packet.number}>{packet.timestamp || 'No timestamp'} · {packet.source} → {packet.detail.destination} · {packet.summary}</p>)}</div></div>}
    <form onSubmit={importAnalysis} className="tool-workbench__form">
      <label>AINetScope analysis JSON<input type="file" accept=".json,application/json" onChange={(event) => setAnalysisFile(event.target.files?.[0] || null)} /></label>
      <button className="primary-button" type="submit" disabled={!analysisFile || !tenantId.trim() || analysisFile.size > 25 * 1024 * 1024}><Upload size={16} /> Import analysis</button>
    </form>
    <p className="tool-workbench__notice">Import accepts `datasnare-ainetscope/analysis-v1` exports up to 25 MiB. Raw PCAP uploads remain capped at 250 MiB.</p>
    {importError && <p className="tool-workbench__error" role="alert">{importError}</p>}
    {importedAnalysis && <div className="tool-workbench__status" role="status"><Activity size={18} /><div><strong>{importedAnalysis.job.artifact_name}</strong><span>{importedAnalysis.job.state} · {importedAnalysis.analysis.event_count} events · {importedAnalysis.analysis.packets?.toLocaleString() ?? 'Unknown'} packets · Job {importedAnalysis.job.job_id}</span><small>{importedAnalysis.analysis.message}</small>{importedAnalysis.analysis.preview.slice(0, 8).map((item, index) => <p key={`${item.category}-${index}`}>{item.timestamp || 'No timestamp'} · {item.severity} · {item.summary}</p>)}</div></div>}
  </section>;
}
