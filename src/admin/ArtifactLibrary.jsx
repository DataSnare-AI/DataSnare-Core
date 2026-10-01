import { useCallback, useEffect, useState } from 'react';
import { Download, FileArchive, RefreshCw, Trash2 } from 'lucide-react';
import { PlanTag } from './adminTags';

async function authFetch(token, path, options = {}) {
  return fetch(path, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) },
  });
}

async function responseError(response, fallback) {
  try {
    const body = await response.json();
    return body.detail || fallback;
  } catch (_) {
    return fallback;
  }
}

function formatBytes(value) {
  const size = Number(value || 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function ArtifactLibrary({ token, profile }) {
  const [tenants, setTenants] = useState([]);
  const [tenantId, setTenantId] = useState('');
  const [artifacts, setArtifacts] = useState([]);
  const [loadingTenants, setLoadingTenants] = useState(false);
  const [loadingArtifacts, setLoadingArtifacts] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const platformAdmin = profile?.role === 'platform_admin';

  const loadTenants = useCallback(async () => {
    setLoadingTenants(true);
    setError('');
    try {
      if (platformAdmin) {
        const response = await authFetch(token, '/api/admin/tenants');
        if (!response.ok) throw new Error(await responseError(response, 'Could not load tenants.'));
        const rows = (await response.json()).tenants || [];
        const unique = [...new Map(rows.map((row) => [row.tenant_id, row])).values()];
        setTenants(unique);
        setTenantId((current) => current || (unique[0] ? String(unique[0].tenant_id) : ''));
      } else {
        const roles = profile?.tenant_roles || {};
        const subscriptions = profile?.tenant_subscriptions || [];
        const tenantsFromProfile = Object.keys(roles).map((id) => ({
          tenant_id: Number(id),
          display_name: subscriptions.find((item) => Number(item.tenant_id) === Number(id))?.tenant_name || `Tenant ${id}`,
        }));
        setTenants(tenantsFromProfile);
        setTenantId((current) => current || (tenantsFromProfile[0] ? String(tenantsFromProfile[0].tenant_id) : ''));
      }
    } catch (loadError) {
      setError(loadError.message || 'Could not load tenant list.');
    } finally {
      setLoadingTenants(false);
    }
  }, [token, profile, platformAdmin]);

  useEffect(() => { loadTenants(); }, [loadTenants]);

  const loadArtifacts = useCallback(async () => {
    if (!tenantId) { setArtifacts([]); return; }
    setLoadingArtifacts(true);
    setError('');
    try {
      const response = await authFetch(token, `/api/tenants/${encodeURIComponent(tenantId)}/artifacts`);
      if (!response.ok) throw new Error(await responseError(response, 'Could not load tenant artifacts.'));
      setArtifacts((await response.json()).artifacts || []);
    } catch (loadError) {
      setError(loadError.message || 'Could not load artifacts.');
    } finally {
      setLoadingArtifacts(false);
    }
  }, [token, tenantId]);

  useEffect(() => { loadArtifacts(); }, [loadArtifacts]);

  const download = async (artifact) => {
    setBusyId(artifact.artifact_id);
    try {
      const response = await authFetch(token, `/api/tenants/${tenantId}/artifacts/${encodeURIComponent(artifact.artifact_id)}/download`);
      if (!response.ok) throw new Error(await responseError(response, 'Could not download artifact.'));
      const objectUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = artifact.artifact_name;
      anchor.click();
      URL.revokeObjectURL(objectUrl);
    } catch (downloadError) {
      setError(downloadError.message || 'Could not download artifact.');
    } finally { setBusyId(''); }
  };

  const remove = async (artifact) => {
    if (!globalThis.confirm(`Delete ${artifact.artifact_name}? This permanently removes the stored file.`)) return;
    setBusyId(artifact.artifact_id);
    try {
      const response = await authFetch(token, `/api/tenants/${tenantId}/artifacts/${encodeURIComponent(artifact.artifact_id)}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(await responseError(response, 'Could not delete artifact.'));
      await loadArtifacts();
    } catch (deleteError) {
      setError(deleteError.message || 'Could not delete artifact.');
    } finally { setBusyId(''); }
  };

  return <section className="admin-console artifact-library" aria-label="Tenant artifact storage">
    <div className="admin-page-heading"><div><a className="admin-back-link" href="#projects">← Workspace</a><p className="eyebrow">Tenant files</p><h1>Artifact Storage</h1></div><p>Browse, download, and manage source files retained in Core storage.</p></div>
    {error && <p className="admin-alert admin-alert--error" role="alert">{error}</p>}
    <section className="admin-panel">
      <div className="admin-panel__heading"><span><FileArchive size={16} /> Stored artifacts</span><button className="icon-button" type="button" onClick={() => { loadTenants(); loadArtifacts(); }} aria-label="Refresh artifacts"><RefreshCw size={14} /></button></div>
      <div className="artifact-toolbar"><label>Tenant<select value={tenantId} disabled={loadingTenants} onChange={(event) => setTenantId(event.target.value)}><option value="">Select tenant…</option>{tenants.map((tenant) => <option key={tenant.tenant_id} value={tenant.tenant_id}>{tenant.display_name} · #{tenant.tenant_id}</option>)}</select></label><span>{artifacts.length} files</span></div>
      <div className="admin-table-scroll"><table className="admin-table artifact-table"><thead><tr><th>File</th><th>Product</th><th>Type</th><th>Size</th><th>Uploaded by</th><th>Date</th><th>Actions</th></tr></thead><tbody>
        {loadingArtifacts ? <tr><td colSpan={7} className="admin-empty">Loading artifacts…</td></tr> : artifacts.map((artifact) => <tr key={artifact.artifact_id}>
          <td><strong>{artifact.artifact_name}</strong><small>{artifact.artifact_id}</small></td>
          <td><PlanTag planKey={artifact.product_key}>{artifact.product_key}</PlanTag></td>
          <td>{artifact.content_type}</td><td>{formatBytes(artifact.size_bytes)}</td><td>{artifact.uploaded_by}</td><td>{artifact.created_at ? new Date(artifact.created_at).toLocaleDateString() : '—'}</td>
          <td><div className="admin-row-actions"><button className="icon-button" type="button" onClick={() => download(artifact)} disabled={busyId === artifact.artifact_id} aria-label={`Download ${artifact.artifact_name}`} title="Download"><Download size={15} /></button><button className="icon-button artifact-delete-button" type="button" onClick={() => remove(artifact)} disabled={busyId === artifact.artifact_id} aria-label={`Delete ${artifact.artifact_name}`} title="Delete"><Trash2 size={15} /></button></div></td>
        </tr>)}
        {!loadingArtifacts && !artifacts.length && <tr><td colSpan={7} className="admin-empty">No stored artifacts for this tenant.</td></tr>}
      </tbody></table></div>
    </section>
  </section>;
}
