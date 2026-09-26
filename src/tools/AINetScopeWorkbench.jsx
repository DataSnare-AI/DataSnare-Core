import { useState } from 'react';
import { Activity, Upload } from 'lucide-react';
import { buildSessionHeaders, readLaunchContext } from '../contracts/session';

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
      const headers = buildSessionHeaders(context, { 'Content-Type': 'application/json' });
      const response = await fetch(`/api/tenants/${encodeURIComponent(tenantId.trim())}/tools/ainetscope/jobs`, {
        method: 'POST', headers, body: JSON.stringify({ artifact_name: file.name, artifact_type: file.name.split('.').pop(), file_size_bytes: file.size }),
      });
      if (!response.ok) throw new Error(`Capture job returned ${response.status}.`);
      setJob(await response.json());
    } catch (submitError) { setError(submitError.message || 'Could not create capture job.'); }
  };

  return <section className="tool-workbench" aria-labelledby="ainetscope-title">
    <p className="eyebrow">AINetScope web migration</p>
    <h2 id="ainetscope-title">Capture analysis job</h2>
    <p>Queue a PCAP or PCAPNG for the Python analysis worker. The existing local analyzer remains available while the worker is being completed.</p>
    <form onSubmit={submit} className="tool-workbench__form">
      <label>Tenant ID<input value={tenantId} onChange={(event) => setTenantId(event.target.value)} inputMode="numeric" /></label>
      <label>Capture file<input type="file" accept=".pcap,.pcapng,.cap" onChange={(event) => setFile(event.target.files?.[0] || null)} /></label>
      <button className="primary-button" type="submit" disabled={!file || !tenantId.trim()}><Upload size={16} /> Queue capture</button>
    </form>
    {error && <p className="tool-workbench__error">{error}</p>}
    {job && <div className="tool-workbench__status"><Activity size={18} /><div><strong>{job.job.artifact_name}</strong><span>{job.job.state} · {job.job.native_conversion.status}</span><small>{job.job.native_conversion.message}</small></div></div>}
  </section>;
}
