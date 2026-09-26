import { useState } from 'react';
import { BarChart3, Cpu, Upload } from 'lucide-react';
import { buildSessionHeaders, readLaunchContext } from '../contracts/session';

const TOOL_CONFIG = {
  aiperf: { label: 'AIPerf', description: 'Queue Performance Monitor evidence for Python-backed analysis.', accept: '.blg,.csv,.xml', icon: BarChart3 },
  aiprocmon: { label: 'AIProcMon', description: 'Queue process activity evidence for Python-backed analysis.', accept: '.pml,.csv,.xml', icon: Cpu },
};

export default function NativeToolWorkbench({ toolId }) {
  const config = TOOL_CONFIG[toolId];
  const Icon = config.icon;
  const context = readLaunchContext();
  const [tenantId, setTenantId] = useState(() => context?.account?.tenantId || '');
  const [file, setFile] = useState(null);
  const [job, setJob] = useState(null);
  const [error, setError] = useState('');
  const submit = async (event) => {
    event.preventDefault(); if (!file || !tenantId.trim()) return; setError('');
    try {
      const response = await fetch(`/api/tenants/${encodeURIComponent(tenantId.trim())}/tools/${toolId}/jobs`, { method: 'POST', headers: buildSessionHeaders(context, { 'Content-Type': 'application/json' }), body: JSON.stringify({ artifact_name: file.name, artifact_type: file.name.split('.').pop() }) });
      if (!response.ok) throw new Error(`Job returned ${response.status}.`);
      setJob(await response.json());
    } catch (submitError) { setJob(null); setError(submitError.message || 'Could not create analysis job.'); }
  };
  return <section className="tool-workbench" aria-labelledby={`${toolId}-title`}><p className="eyebrow">{config.label} web migration</p><h2 id={`${toolId}-title`}>{config.label} analysis job</h2><p>{config.description}</p><form onSubmit={submit} className="tool-workbench__form"><label>Tenant ID<input value={tenantId} onChange={(event) => setTenantId(event.target.value)} inputMode="numeric" /></label><label>Evidence file<input type="file" accept={config.accept} onChange={(event) => setFile(event.target.files?.[0] || null)} /></label><button className="primary-button" type="submit" disabled={!file || !tenantId.trim()}><Upload size={16} /> Queue analysis</button></form>{error && <p className="tool-workbench__error">{error}</p>}{job && <div className="tool-workbench__status"><Icon size={18} /><div><strong>{job.job.artifact_name}</strong><span>{job.job.state} · Python converter planned</span><small>{job.job.normalized_schema}</small></div></div>}</section>;
}
