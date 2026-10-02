import { useState } from 'react';
import { FileText, Upload } from 'lucide-react';
import { buildRequestHeaders, readLaunchContext } from '../contracts/session';
import TenantSelect, { useTenantSelection } from './TenantSelect';

export default function AILogScopeWorkbench({ selectedTenantId, profile, token } = {}) {
  const selection = useTenantSelection({ profile, token, enabled: selectedTenantId === undefined });
  const tenantId = String(selectedTenantId ?? selection.tenantId);
  return <>{selectedTenantId === undefined && <TenantSelect selection={selection} />}<LogWorkbench key={tenantId} tenantId={tenantId} /></>;
}

function LogWorkbench({ tenantId }) {
  const launchContext = readLaunchContext();
  const context = { ...launchContext, account: { ...launchContext?.account, tenantId } };
  const [file, setFile] = useState(null);
  const [job, setJob] = useState(null);
  const [jobId, setJobId] = useState(() => localStorage.getItem(`datasnare:ailogscope:${tenantId}:last-job`) || '');
  const [loadingJob, setLoadingJob] = useState(false);
  const [error, setError] = useState('');

  const requestHeaders = async (json = false) => {
    return buildRequestHeaders(context, json ? { 'Content-Type': 'application/json' } : {});
  };

  const loadJob = async (event) => {
    event.preventDefault();
    if (!tenantId.trim() || !jobId.trim()) return;
    setError('');
    setLoadingJob(true);
    try {
      const response = await fetch(
        `/api/tenants/${encodeURIComponent(tenantId.trim())}/tools/ailogscope/jobs/${encodeURIComponent(jobId.trim())}`,
        { headers: await requestHeaders() },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || `Could not load job (${response.status}).`);
      if (!result.analysis) throw new Error(`Job ${result.job.state}; no completed analysis is available.`);
      setJob(result);
    } catch (loadError) {
      setJob(null);
      setError(loadError.message || 'Could not load the analysis job.');
    } finally {
      setLoadingJob(false);
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!file || !tenantId.trim()) return;
    setError('');
    try {
      const headers = await requestHeaders(true);
      const base = `/api/tenants/${encodeURIComponent(tenantId.trim())}/tools/ailogscope/jobs`;
      const created = await fetch(base, { method: 'POST', headers, body: JSON.stringify({ artifact_name: file.name, artifact_type: file.name.split('.').pop() }) });
      if (!created.ok) throw new Error(`Log job returned ${created.status}.`);
      const queued = await created.json();
      setJobId(queued.job.job_id);
      localStorage.setItem(`datasnare:ailogscope:${tenantId}:last-job`, queued.job.job_id);
      const uploaded = await fetch(`${base}/${queued.job.job_id}/artifact`, { method: 'POST', headers: await requestHeaders(), body: await file.arrayBuffer() });
      const result = await uploaded.json();
      if (!uploaded.ok) throw new Error(result.detail || `Log upload returned ${uploaded.status}.`);
      setJob(result);
    } catch (submitError) { setJob(null); setError(submitError.message || 'Could not process log evidence.'); }
  };

  return <section className="tool-workbench" aria-labelledby="ailogscope-title"><p className="eyebrow">AILogScope web migration</p><h2 id="ailogscope-title">Log evidence job</h2><p>Normalize application logs and text notes through the Python ingestion boundary while retaining the local analyzer for offline review.</p><form onSubmit={submit} className="tool-workbench__form"><label>Log or text file<input type="file" accept=".log,.txt,.json,.yaml,.pdf" onChange={(event) => setFile(event.target.files?.[0] || null)} /></label><button className="primary-button" type="submit" disabled={!file || !tenantId.trim()}><Upload size={16} /> Analyze log</button></form><form onSubmit={loadJob} className="tool-workbench__recover"><label>Load previous job<input value={jobId} onChange={(event) => setJobId(event.target.value)} placeholder="Job ID" /></label><button className="admin-secondary-button" type="submit" disabled={loadingJob || !tenantId.trim() || !jobId.trim()}>{loadingJob ? 'Loading…' : 'Load job'}</button></form>{error && <p className="tool-workbench__error" role="alert">{error}</p>}{job && job.analysis && <div className="tool-workbench__status"><FileText size={18} /><div><strong>{job.job.artifact_name}</strong><span>{job.job.state} · {job.analysis.events.toLocaleString()} events · Job {job.job.job_id}</span><small>{job.analysis.source_encoding} · {job.analysis.message}</small><div className="log-job__levels">{Object.entries(job.analysis.severity_counts || {}).map(([level, count]) => <span key={level}>{level} {count.toLocaleString()}</span>)}</div><details className="log-job__preview"><summary>Normalized event preview ({job.analysis.preview?.length || 0})</summary><div>{(job.analysis.preview || []).slice(0, 12).map((event, index) => <article className={`log-job__event log-job__event--${event.severity}`} key={`${event.evidence.sourceLine}-${index}`}><time>{event.timestamp || 'No timestamp'}</time><b>{event.severity}</b><p>{event.summary}</p><small>Line {event.evidence.sourceLine}</small></article>)}</div></details></div></div>}</section>;
}
