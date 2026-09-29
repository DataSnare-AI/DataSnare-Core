import { useState } from 'react';
import { FileText, Upload } from 'lucide-react';
import { buildSessionHeaders, readLaunchContext } from '../contracts/session';

export default function AILogScopeWorkbench() {
  const context = readLaunchContext();
  const [tenantId, setTenantId] = useState(() => context?.account?.tenantId || '');
  const [file, setFile] = useState(null);
  const [job, setJob] = useState(null);
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    if (!file || !tenantId.trim()) return;
    setError('');
    try {
      const headers = buildSessionHeaders(context, { 'Content-Type': 'application/json' });
      if (!context?.account?.actorId) {
        const readiness = await fetch('/api/health/readiness');
        const deployment = readiness.ok ? await readiness.json() : null;
        if (deployment?.environment !== 'development') throw new Error('Sign in through Core before submitting tenant evidence.');
        headers.set('X-Actor', 'core-staging-ui');
        headers.set('X-Role', 'operator');
      }
      const base = `/api/tenants/${encodeURIComponent(tenantId.trim())}/tools/ailogscope/jobs`;
      const created = await fetch(base, { method: 'POST', headers, body: JSON.stringify({ artifact_name: file.name, artifact_type: file.name.split('.').pop() }) });
      if (!created.ok) throw new Error(`Log job returned ${created.status}.`);
      const queued = await created.json();
      const uploadHeaders = buildSessionHeaders(context);
      if (headers.has('X-Actor')) uploadHeaders.set('X-Actor', headers.get('X-Actor'));
      if (headers.has('X-Role')) uploadHeaders.set('X-Role', headers.get('X-Role'));
      const uploaded = await fetch(`${base}/${queued.job.job_id}/artifact`, { method: 'POST', headers: uploadHeaders, body: await file.arrayBuffer() });
      if (!uploaded.ok) throw new Error(`Log upload returned ${uploaded.status}.`);
      setJob(await uploaded.json());
    } catch (submitError) { setJob(null); setError(submitError.message || 'Could not process log evidence.'); }
  };

  return <section className="tool-workbench" aria-labelledby="ailogscope-title"><p className="eyebrow">AILogScope web migration</p><h2 id="ailogscope-title">Log evidence job</h2><p>Normalize application logs and text notes through the Python ingestion boundary while retaining the local analyzer for offline review.</p>{!context?.account?.actorId && <p className="tool-workbench__notice">Staging mode: uploads use the temporary Core staging operator identity. Production requires Core sign-in.</p>}<form onSubmit={submit} className="tool-workbench__form"><label>Tenant ID<input value={tenantId} onChange={(event) => setTenantId(event.target.value)} inputMode="numeric" /></label><label>Log or text file<input type="file" accept=".log,.txt,.json,.yaml,.pdf" onChange={(event) => setFile(event.target.files?.[0] || null)} /></label><button className="primary-button" type="submit" disabled={!file || !tenantId.trim()}><Upload size={16} /> Analyze log</button></form>{error && <p className="tool-workbench__error">{error}</p>}{job && <div className="tool-workbench__status"><FileText size={18} /><div><strong>{job.job.artifact_name}</strong><span>{job.job.state} · {job.analysis.events.toLocaleString()} events</span><small>{job.analysis.source_encoding} · {job.analysis.message}</small><div className="log-job__levels">{Object.entries(job.analysis.severity_counts || {}).map(([level, count]) => <span key={level}>{level} {count.toLocaleString()}</span>)}</div><details className="log-job__preview"><summary>Normalized event preview ({job.analysis.preview?.length || 0})</summary><div>{(job.analysis.preview || []).slice(0, 12).map((event, index) => <article className={`log-job__event log-job__event--${event.severity}`} key={`${event.evidence.sourceLine}-${index}`}><time>{event.timestamp || 'No timestamp'}</time><b>{event.severity}</b><p>{event.summary}</p><small>Line {event.evidence.sourceLine}</small></article>)}</div></details></div></div>}</section>;
}
