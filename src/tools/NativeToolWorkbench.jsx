import { useState } from 'react';
import { BarChart3, Cpu, Download, ExternalLink, FileText, Upload, Workflow } from 'lucide-react';
import { buildRequestHeaders, readLaunchContext } from '../contracts/session';
import TenantSelect, { useTenantSelection } from './TenantSelect';

const TOOL_CONFIG = {
  airca: { label: 'AIRootCause', eyebrow: 'AIRootCause investigation import', title: 'Import investigation', description: 'Import a saved AIRootCause investigation JSON export into this tenant. Its timestamped events and report findings become selectable AIAnalysis evidence.', accept: '.json', icon: Workflow },
  aiperf: { label: 'AIPerf', description: 'Analyze converted PerfMon CSV and System Diagnostics XML; native BLG requires Windows conversion.', accept: '.blg,.csv,.xml', icon: BarChart3, fullAnalyzer: true },
  aiprocmon: { label: 'AIProcMon', description: 'Analyze ProcMon CSV/XML; native PML requires Windows conversion.', accept: '.pml,.csv,.xml', icon: Cpu, fullAnalyzer: true },
};

export default function NativeToolWorkbench({ toolId, selectedTenantId, profile, token, onJobCompleted }) {
  const selection = useTenantSelection({ profile, token, enabled: selectedTenantId === undefined });
  const tenantId = String(selectedTenantId ?? selection.tenantId);
  return <>{selectedTenantId === undefined && <TenantSelect selection={selection} />}<NativeWorkbench key={`${toolId}:${tenantId}`} toolId={toolId} tenantId={tenantId} onJobCompleted={onJobCompleted} /></>;
}

function NativeWorkbench({ toolId, tenantId, onJobCompleted }) {
  const config = TOOL_CONFIG[toolId];
  const Icon = config.icon;
  const launchContext = readLaunchContext();
  const context = { ...launchContext, account: { ...launchContext?.account, tenantId } };
  const [file, setFile] = useState(null);
  const [exportFile, setExportFile] = useState(null);
  const [job, setJob] = useState(null);
  const [error, setError] = useState('');
  const [captureDate, setCaptureDate] = useState(new Date().toISOString().slice(0, 10));
  const [timezoneOffset, setTimezoneOffset] = useState('-04:00');
  const [busy, setBusy] = useState(false);
  const analysisEvents = Array.isArray(job?.analysis?.events) ? job.analysis.events : job?.analysis?.preview || [];
  const eventCount = job?.analysis?.event_count ?? (Array.isArray(job?.analysis?.events) ? job.analysis.events.length : job?.analysis?.events);
  const submit = async (event, importExport = false) => {
    event.preventDefault();
    const selectedFile = importExport ? exportFile : file;
    if (!selectedFile || !tenantId.trim() || busy) return;
    setError('');
    setBusy(true);
    try {
      const headers = await buildRequestHeaders(context, { 'Content-Type': 'application/json' });
      const artifactType = importExport ? 'json' : selectedFile.name.split('.').pop().toLowerCase();
      const response = await fetch(`/api/tenants/${encodeURIComponent(tenantId.trim())}/tools/${toolId}/jobs`, { method: 'POST', headers, body: JSON.stringify({ artifact_name: selectedFile.name, artifact_type: artifactType, ...(toolId === 'aiprocmon' && !importExport ? { capture_date: captureDate, timezone_offset: timezoneOffset } : {}) }) });
      const queued = await response.json();
      if (!response.ok) throw new Error(queued.detail || `Job returned ${response.status}.`);
      if ((toolId === 'aiperf' && artifactType === 'blg') || (toolId === 'aiprocmon' && artifactType === 'pml')) { setJob(queued); return; }
      const uploadHeaders = await buildRequestHeaders(context);
      const uploaded = await fetch(`/api/tenants/${encodeURIComponent(tenantId.trim())}/tools/${toolId}/jobs/${queued.job.job_id}/artifact`, { method: 'POST', headers: uploadHeaders, body: await selectedFile.arrayBuffer() });
      const result = await uploaded.json();
      if (!uploaded.ok) throw new Error(result.detail || `Artifact upload returned ${uploaded.status}.`);
      setJob(result);
      await onJobCompleted?.(queued.job.job_id);
    } catch (submitError) { setJob(null); setError(submitError.message || 'Could not create analysis job.'); }
    finally { setBusy(false); }
  };
  return <section className="tool-workbench" aria-labelledby={`${toolId}-title`}>
    <p className="eyebrow">{config.eyebrow || `${config.label} web migration`}</p>
    <h2 id={`${toolId}-title`}>{config.title || `${config.label} analysis job`}</h2>
    <p>{config.description}</p>
    {config.fullAnalyzer && <>
      <p><a className="admin-secondary-button" href={`/${toolId}/index.html?returnTo=%2Faianalysis`} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} /> Open full {config.label}</a></p>
      <div className="tool-workbench__conversion">
        <a className="admin-secondary-button" href={`/${toolId}/tools/${toolId === 'aiprocmon' ? 'Convert-ProcMon.ps1' : 'Convert-PerfMon.ps1'}`} download><Download size={15} /> Download Windows conversion helper</a>
        <a className="admin-secondary-button" href={`/${toolId}/tools/Conversion-Instructions.md`} download><FileText size={15} /> Download conversion instructions</a>
        <p>Local-only PowerShell helper (unsigned). {toolId === 'aiprocmon' ? 'Requires Microsoft Procmon64.exe; running the helper accepts its EULA. Set the original capture date and UTC offset before CSV import.' : 'Requires Windows relog.exe. Verify regional settings and PDH timezone information before CSV import.'} No automatic upload.</p>
      </div>
      <form className="tool-workbench__form" onSubmit={(event) => submit(event, true)}>
        <label>{config.label} analysis JSON<input type="file" accept=".json,application/json" disabled={busy} onChange={(event) => setExportFile(event.target.files?.[0] || null)} /></label>
        <button className="primary-button" type="submit" disabled={busy || !exportFile || !tenantId.trim() || exportFile.size > 25 * 1024 * 1024}><Upload size={16} /> {busy ? 'Processing...' : 'Import analysis'}</button>
      </form>
    </>}
    {toolId === 'airca' && <p className="tool-workbench__notice">Accepts AIRootCause investigation JSON exports up to 25 MiB and 10,000 events. Importing creates a tenant-scoped evidence job; it does not execute plugin code.</p>}
    <form onSubmit={(event) => submit(event)} className="tool-workbench__form">
      {toolId === 'aiprocmon' && <>
        <label>Capture date<input type="date" value={captureDate} onChange={(event) => setCaptureDate(event.target.value)} /></label>
        <label>UTC offset<input value={timezoneOffset} onChange={(event) => setTimezoneOffset(event.target.value)} placeholder="-04:00" /></label>
      </>}
      <label>{toolId === 'airca' ? 'Investigation export' : 'Evidence file'}<input type="file" accept={config.accept} disabled={busy} onChange={(event) => setFile(event.target.files?.[0] || null)} /></label>
      <button className="primary-button" type="submit" disabled={!file || !tenantId.trim() || busy}><Upload size={16} /> {busy ? 'Processing...' : toolId === 'airca' ? 'Import investigation' : 'Analyze evidence'}</button>
    </form>
    {error && <p className="tool-workbench__error" role="alert">{error}</p>}
    {job && <div className="tool-workbench__status" role="status"><Icon size={18} /><div>
      <strong>{job.job.artifact_name}</strong><span>{job.job.state} · {eventCount ?? 'converter required'} events · Job {job.job.job_id}</span>
      <small>{job.analysis?.message || `${job.job.native_conversion?.strategy}: ${job.job.native_conversion?.status}`}</small>
      {job.analysis?.findings?.length > 0 && <ul>{job.analysis.findings.slice(0, 5).map((finding, index) => <li key={finding.id || index}>{finding.title || finding.summary}: {finding.detail}</li>)}</ul>}
      {analysisEvents.slice(0, 5).map((event, index) => <p key={event.id || index}>{event.timestamp || 'No timestamp'} · {event.severity} · {event.summary}</p>)}
    </div></div>}
  </section>;
}
