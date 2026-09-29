import { useState } from 'react';
import { Activity, Upload } from 'lucide-react';
import { buildRequestHeaders, readLaunchContext } from '../contracts/session';

export default function AINetScopeWorkbench() {
  const [file, setFile] = useState(null);
  const [tenantId, setTenantId] = useState(() => readLaunchContext()?.account?.tenantId || '');
  const [job, setJob] = useState(null);
  const [error, setError] = useState('');
  const context = readLaunchContext();

  const submit = async (event) => {
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
    } catch (submitError) { setError(submitError.message || 'Could not create capture job.'); }
  };

  return <section className="tool-workbench" aria-labelledby="ainetscope-title">
    <p className="eyebrow">AINetScope web migration</p>
    <h2 id="ainetscope-title">Capture analysis job</h2>
    <p>Upload a PCAP or PCAPNG for Python packet decoding. The existing local analyzer remains available for larger offline captures.</p>
    <form onSubmit={submit} className="tool-workbench__form">
      <label>Tenant ID<input value={tenantId} onChange={(event) => setTenantId(event.target.value)} inputMode="numeric" /></label>
      <label>Capture file<input type="file" accept=".pcap,.pcapng,.cap" onChange={(event) => setFile(event.target.files?.[0] || null)} /></label>
      <button className="primary-button" type="submit" disabled={!file || !tenantId.trim() || file.size > 250 * 1024 * 1024}><Upload size={16} /> Analyze capture</button>
    </form>
    {error && <p className="tool-workbench__error">{error}</p>}
    {job && <div className="tool-workbench__status"><Activity size={18} /><div><strong>{job.job.artifact_name}</strong><span>{job.job.state} · {job.analysis.packets.toLocaleString()} packets · {job.analysis.flows.toLocaleString()} flows · {job.analysis.hosts.toLocaleString()} hosts</span><small>{job.analysis.message}</small><small>{Object.entries(job.analysis.protocols).map(([protocol, count]) => `${protocol} ${count}`).join(' · ')}</small>{job.analysis.findings.map(finding => <p key={finding.id}>{finding.severity}: {finding.title} · {finding.detail}</p>)}{job.analysis.preview.slice(0, 8).map(packet => <p key={packet.number}>{packet.timestamp || 'No timestamp'} · {packet.source} → {packet.detail.destination} · {packet.summary}</p>)}</div></div>}
  </section>;
}
