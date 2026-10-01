import { useCallback, useEffect, useState } from 'react';
import { Building2, KeyRound, Package, RefreshCw, UserPlus, Users } from 'lucide-react';

const ROLES = ['viewer', 'operator', 'approver', 'tenant_admin', 'platform_admin'];

function authFetch(token, path, options = {}) {
  return fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(options.headers || {}) },
  });
}

async function readError(response, fallback) {
  try {
    const body = await response.json();
    return body.detail || fallback;
  } catch (_) {
    return fallback;
  }
}

function UsersPanel({ token, onError, onNotice }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState({ username: '', display_name: '', email: '', password: '', global_role: 'viewer' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await authFetch(token, '/api/admin/users');
      if (!response.ok) throw new Error(await readError(response, 'Could not load users.'));
      setUsers((await response.json()).users || []);
    } catch (error) {
      onError(error.message);
    } finally {
      setLoading(false);
    }
  }, [token, onError]);

  useEffect(() => { load(); }, [load]);

  const createUser = async (event) => {
    event.preventDefault();
    try {
      const body = { ...draft };
      if (!body.password) delete body.password;
      const response = await authFetch(token, '/api/admin/users', { method: 'POST', body: JSON.stringify(body) });
      if (!response.ok) throw new Error(await readError(response, 'Could not create the user.'));
      setDraft({ username: '', display_name: '', email: '', password: '', global_role: 'viewer' });
      onNotice(`Created ${body.username}.`);
      load();
    } catch (error) { onError(error.message); }
  };

  const patchUser = async (username, changes, notice) => {
    try {
      const response = await authFetch(token, `/api/admin/users/${encodeURIComponent(username)}`, { method: 'PATCH', body: JSON.stringify(changes) });
      if (!response.ok) throw new Error(await readError(response, 'Could not update the user.'));
      onNotice(notice);
      load();
    } catch (error) { onError(error.message); }
  };

  return (
    <div className="admin-panel">
      <div className="admin-panel__heading"><span><Users size={16} /> Users</span><button className="icon-button" type="button" onClick={load} aria-label="Refresh users"><RefreshCw size={14} /></button></div>
      <form className="admin-form" onSubmit={createUser}>
        <label>Username<input value={draft.username} onChange={(e) => setDraft({ ...draft, username: e.target.value })} required /></label>
        <label>Display name<input value={draft.display_name} onChange={(e) => setDraft({ ...draft, display_name: e.target.value })} /></label>
        <label>Email<input type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} /></label>
        <label>Password<input type="password" minLength={12} value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} placeholder="Leave blank to invite" /></label>
        <label>Role<select value={draft.global_role} onChange={(e) => setDraft({ ...draft, global_role: e.target.value })}>{ROLES.map((role) => <option key={role} value={role}>{role}</option>)}</select></label>
        <button className="primary-button" type="submit"><UserPlus size={15} /> Add user</button>
      </form>
      {loading ? <p className="admin-empty">Loading users…</p> : (
        <table className="admin-table">
          <thead><tr><th>User</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.username}>
                <td><strong>{user.display_name || user.username}</strong><small>{user.username}{user.source_system === 'aiops' ? ' · imported' : ''}</small></td>
                <td>
                  <select value={user.global_role} onChange={(e) => patchUser(user.username, { global_role: e.target.value }, `Updated role for ${user.username}.`)}>
                    {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
                  </select>
                </td>
                <td>{user.invite_pending ? <span className="admin-pill admin-pill--warn">invite pending</span> : <span className={user.is_active ? 'admin-pill admin-pill--good' : 'admin-pill'}>{user.is_active ? 'active' : 'disabled'}</span>}</td>
                <td><button className="quiet-button quiet-button--small" type="button" onClick={() => patchUser(user.username, { is_active: !user.is_active }, `${user.is_active ? 'Disabled' : 'Enabled'} ${user.username}.`)}>{user.is_active ? 'Disable' : 'Enable'}</button></td>
              </tr>
            ))}
            {!users.length && <tr><td colSpan={4} className="admin-empty">No users yet.</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}

function TenantsPanel({ token, onError, onNotice }) {
  const [tenants, setTenants] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState({ display_name: '', tenant_id: '' });
  const [assignment, setAssignment] = useState({ tenant_id: '', product_key: '', plan_key: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tenantResponse, catalogResponse] = await Promise.all([
        authFetch(token, '/api/admin/tenants'),
        authFetch(token, '/api/admin/catalog'),
      ]);
      if (!tenantResponse.ok) throw new Error(await readError(tenantResponse, 'Could not load tenants.'));
      if (!catalogResponse.ok) throw new Error(await readError(catalogResponse, 'Could not load the catalog.'));
      setTenants((await tenantResponse.json()).tenants || []);
      setCatalog(((await catalogResponse.json()).entries || []).filter((entry) => entry.plan_key));
    } catch (error) {
      onError(error.message);
    } finally {
      setLoading(false);
    }
  }, [token, onError]);

  useEffect(() => { load(); }, [load]);

  const createTenant = async (event) => {
    event.preventDefault();
    try {
      const body = { display_name: draft.display_name };
      if (draft.tenant_id) body.tenant_id = Number(draft.tenant_id);
      const response = await authFetch(token, '/api/admin/tenants', { method: 'POST', body: JSON.stringify(body) });
      if (!response.ok) throw new Error(await readError(response, 'Could not create the tenant.'));
      setDraft({ display_name: '', tenant_id: '' });
      onNotice(`Created ${body.display_name}.`);
      load();
    } catch (error) { onError(error.message); }
  };

  const assignPlan = async (event) => {
    event.preventDefault();
    const [product_key, plan_key] = assignment.plan_key.split('::');
    if (!assignment.tenant_id || !product_key) { onError('Select a tenant and a plan.'); return; }
    try {
      const response = await authFetch(token, `/api/admin/tenants/${assignment.tenant_id}/entitlements`, {
        method: 'PUT',
        body: JSON.stringify({ product_key, plan_key }),
      });
      if (!response.ok) throw new Error(await readError(response, 'Could not assign the plan.'));
      onNotice(`Assigned ${plan_key} to tenant ${assignment.tenant_id}.`);
      setAssignment({ tenant_id: '', product_key: '', plan_key: '' });
      load();
    } catch (error) { onError(error.message); }
  };

  const uniqueTenants = [...new Map(tenants.map((row) => [row.tenant_id, row])).values()];

  return (
    <div className="admin-panel">
      <div className="admin-panel__heading"><span><Building2 size={16} /> Tenants and plans</span><button className="icon-button" type="button" onClick={load} aria-label="Refresh tenants"><RefreshCw size={14} /></button></div>
      <form className="admin-form" onSubmit={createTenant}>
        <label>Tenant name<input value={draft.display_name} onChange={(e) => setDraft({ ...draft, display_name: e.target.value })} required /></label>
        <label>Tenant ID<input inputMode="numeric" value={draft.tenant_id} onChange={(e) => setDraft({ ...draft, tenant_id: e.target.value })} placeholder="Optional" /></label>
        <button className="primary-button" type="submit"><Building2 size={15} /> Add tenant</button>
      </form>
      <form className="admin-form" onSubmit={assignPlan}>
        <label>Tenant
          <select value={assignment.tenant_id} onChange={(e) => setAssignment({ ...assignment, tenant_id: e.target.value })}>
            <option value="">Select…</option>
            {uniqueTenants.map((tenant) => <option key={tenant.tenant_id} value={tenant.tenant_id}>{tenant.display_name}</option>)}
          </select>
        </label>
        <label>Plan
          <select value={assignment.plan_key} onChange={(e) => setAssignment({ ...assignment, plan_key: e.target.value })}>
            <option value="">Select…</option>
            {catalog.map((entry) => <option key={`${entry.product_key}::${entry.plan_key}`} value={`${entry.product_key}::${entry.plan_key}`}>{entry.product_name} · {entry.plan_name}</option>)}
          </select>
        </label>
        <button className="primary-button" type="submit"><Package size={15} /> Assign plan</button>
      </form>
      {loading ? <p className="admin-empty">Loading tenants…</p> : (
        <table className="admin-table">
          <thead><tr><th>Tenant</th><th>Product</th><th>Plan</th><th>Members</th></tr></thead>
          <tbody>
            {tenants.map((row) => (
              <tr key={`${row.tenant_id}-${row.product_key || 'none'}`}>
                <td><strong>{row.display_name}</strong><small>#{row.tenant_id} · {row.status}</small></td>
                <td>{row.product_key || <span className="admin-empty">—</span>}</td>
                <td>{row.plan_key ? <span className="admin-pill admin-pill--good">{row.plan_key}</span> : <span className="admin-pill admin-pill--warn">no plan</span>}</td>
                <td>{row.member_count}</td>
              </tr>
            ))}
            {!tenants.length && <tr><td colSpan={4} className="admin-empty">No tenants yet.</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function AdminConsole({ token }) {
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const report = (message) => { setError(message); setNotice(''); };
  const announce = (message) => { setNotice(message); setError(''); };

  return (
    <section className="admin-console" id="admin">
      <div className="section-heading">
        <div><p className="eyebrow">Platform administration</p><h2>Accounts, tenants, and plans.</h2></div>
        <p>Core owns suite identity and product entitlements. Changes here apply to every DataSnare product.</p>
      </div>
      {error && <p className="admin-alert admin-alert--error" role="alert"><KeyRound size={14} /> {error}</p>}
      {notice && <p className="admin-alert" role="status">{notice}</p>}
      <div className="admin-grid">
        <UsersPanel token={token} onError={report} onNotice={announce} />
        <TenantsPanel token={token} onError={report} onNotice={announce} />
      </div>
    </section>
  );
}
