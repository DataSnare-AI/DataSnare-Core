import { useState } from 'react';
import { BarChart3, Cpu, Upload } from 'lucide-react';
import { buildRequestHeaders, readLaunchContext } from '../contracts/session';
import TenantSelect, { useTenantSelection } from './TenantSelect';

const TOOL_CONFIG = {
  aiperf: { label: 'AIPerf', description: 'Analyze converted PerfMon CSV and System Diagnostics XML; native BLG queues for Windows conversion.', accept: '.blg,.csv,.xml', icon: BarChart3 },
  aiprocmon: { label: 'AIProcMon', description: 'Analyze ProcMon CSV/XML; native PML queues for Windows conversion.', accept: '.pml,.csv,.xml', icon: Cpu },
};

export default function NativeToolWorkbench({ toolId, selectedTenantId, profile, token }) {
  const selection = useTenantSelection({ profile, token, enabled: selectedTenantId === undefined });
  const tenantId = String(selectedTenantId ?? selection.tenantId);
  return <>{selectedTenantId === undefined && <TenantSelect selection={selection} />}<NativeWorkbench key={`${toolId}:${tenantId}`} toolId={toolId} tenantId={tenantId} /></>;
}

function NativeWorkbench({ toolId, tenantId }) {
  const config = TOOL_CONFIG[toolId];
  const Icon = config.icon;
  const launchContext = readLaunchContext();
  const context = { ...launchContext, account: { ...launchContext?.account, tenantId } };
  const [file, setFile] = useState(null);
  const [job, setJob] = useState(null);
  const [error, setError] = useState('');
  const [captureDate, setCaptureDate] = useState(new Date().toISOString().slice(0, 10));
  const [timezoneOffset, setTimezoneOffset] = useState('-04:00');
  const analysisEvents = Array.isArray(job?.analysis?.events) ? job.analysis.events : job?.analysis?.preview || [];
  const eventCount = job?.analysis?.event_count ?? (Array.isArray(job?.analysis?.events) ? job.analysis.events.length : job?.analysis?.events);
  const submit = async (event) => {
    event.preventDefault(); if (!file || !tenantId.trim()) return; setError('');
    try {
      const headers = await buildRequestHeaders(context, { 'Content-Type': 'application/json' });
      const artifactType = file.name.split('.').pop().toLowerCase();
      const response = await fetch(`/api/tenants/${encodeURIComponent(tenantId.trim())}/tools/${toolId}/jobs`, { method: 'POST', headers, body: JSON.stringify({ artifact_name: file.name, artifact_type: artifactType, ...(toolId === 'aiprocmon' ? { capture_date: captureDate, timezone_offset: timezoneOffset } : {}) }) });
      if (!response.ok) throw new Error(`Job returned ${response.status}.`);
      const queued = await response.json();
      if ((toolId === 'aiperf' && artifactType === 'blg') || (toolId === 'aiprocmon' && artifactType === 'pml')) { setJob(queued); return; }
      const uploadHeaders = await buildRequestHeaders(context);
      const uploaded = await fetch(`/api/tenants/${encodeURIComponent(tenantId.trim())}/tools/${toolId}/jobs/${queued.job.job_id}/artifact`, { method: 'POST', headers: uploadHeaders, body: await file.arrayBuffer() });
      if (!uploaded.ok) throw new Error(`Artifact upload returned ${uploaded.status}: ${(await uploaded.json()).detail || 'upload failed'}`);
      setJob(await uploaded.json());
    } catch (submitError) { setJob(null); setError(submitError.message || 'Could not create analysis job.'); }
  };
  return <section className="tool-workbench" aria-labelledby={`${toolId}-title`}><p className="eyebrow">{config.label} web migration</p><h2 id={`${toolId}-title`}>{config.label} analysis job</h2><p>{config.description}</p><form onSubmit={submit} className="tool-workbench__form">{toolId === 'aiprocmon' && <><label>Capture date<input type="date" value={captureDate} onChange={(event) => setCaptureDate(event.target.value)} /></label><label>UTC offset<input value={timezoneOffset} onChange={(event) => setTimezoneOffset(event.target.value)} placeholder="-04:00" /></label></>}<label>Evidence file<input type="file" accept={config.accept} onChange={(event) => setFile(event.target.files?.[0] || null)} /></label><button className="primary-button" type="submit" disabled={!file || !tenantId.trim()}><Upload size={16} /> Analyze evidence</button></form>{error && <p className="tool-workbench__error">{error}</p>}{job && <div className="tool-workbench__status"><Icon size={18} /><div><strong>{job.job.artifact_name}</strong><span>{job.job.state} · {eventCount ?? 'converter required'} events</span><small>{job.analysis?.message || `${job.job.native_conversion?.strategy}: ${job.job.native_conversion?.status}`}</small>{job.analysis?.findings?.length > 0 && <ul>{job.analysis.findings.slice(0, 5).map((finding, index) => <li key={finding.id || index}>{finding.title || finding.summary}: {finding.detail}</li>)}</ul>}{analysisEvents.slice(0, 5).map((event, index) => <p key={event.id || index}>{event.timestamp || 'No timestamp'} · {event.severity} · {event.summary}</p>)}</div></div>}</section>;
}
