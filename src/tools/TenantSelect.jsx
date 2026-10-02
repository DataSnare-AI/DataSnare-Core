import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { loadNamedTenants } from './workspaceContext';

export function useTenantSelection({ profile, token, enabled = true } = {}) {
  const authToken = token ?? localStorage.getItem('datasnare:auth-token') ?? '';
  const [directory, setDirectory] = useState({ tenants: [], loading: false, error: '', token: '' });
  const [revision, setRevision] = useState(0);
  const [requestedId, setRequestedId] = useState(() => localStorage.getItem('datasnare:tenant-id') || '');
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setDirectory((current) => ({ tenants: current.token === authToken ? current.tenants : [], loading: Boolean(authToken), error: '', token: authToken }));
    if (!authToken) return;
    const load = async () => {
      const tenants = await loadNamedTenants({ profile, token: authToken, refresh: Boolean(revision) });
      if (!cancelled) setDirectory({ tenants, loading: false, error: '', token: authToken });
    };
    load().catch((error) => {
      if (!cancelled) setDirectory({ tenants: [], loading: false, error: error.message, token: authToken });
    });
    return () => { cancelled = true; };
  }, [profile, authToken, enabled, revision]);
  const tenants = directory.token === authToken ? directory.tenants : [];
  const selectedTenant = tenants.find((tenant) => tenant.id === String(Number(requestedId))) || tenants[0];
  const selectTenant = (id) => {
    setRequestedId(id);
    localStorage.setItem('datasnare:tenant-id', id);
  };
  return {
    tenants, tenantId: selectedTenant?.id || '', tenantName: selectedTenant?.name || '',
    loading: directory.loading || Boolean(authToken && directory.token !== authToken),
    error: directory.error, signedIn: Boolean(authToken), selectTenant,
    refresh: () => setRevision((value) => value + 1),
  };
}

export default function TenantSelect({ selection }) {
  const { tenants, tenantId, loading, error, signedIn, selectTenant, refresh } = selection;
  const emptyText = !signedIn ? 'Sign in to choose a tenant' : loading ? 'Loading tenants...' : error ? 'Tenant list unavailable' : 'No named tenants assigned';
  return <div className="tenant-select">
    <label>Tenant name<select value={tenantId} onChange={(event) => selectTenant(event.target.value)} disabled={loading || !tenants.length}>
      {!tenants.length && <option value="">{emptyText}</option>}
      {tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
    </select></label>
    <button className="icon-button" type="button" title="Refresh tenants" aria-label="Refresh tenants" disabled={loading || !signedIn} onClick={refresh}><RefreshCw size={16} /></button>
    {error && <p className="tool-workbench__error" role="alert">{error}</p>}
  </div>;
}