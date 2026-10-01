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
  const [loading, setLoading] = useState(false);
  const [onboardOpen, setOnboardOpen] = useState(false);
  const [draft, setDraft] = useState({
    tenant_name: '', company_name: '', primary_address: '', phone: '', contact_email: '',
    primary_contact_name: '', billing_contact_name: '', billing_contact_email: '',
    max_users: '10', max_systems: '50', contract_start_date: '', contract_end_date: '', notes: '', tenant_id: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const tenantResponse = await authFetch(token, '/api/admin/tenants');
      if (!tenantResponse.ok) throw new Error(await readError(tenantResponse, 'Could not load tenants.'));
      setTenants((await tenantResponse.json()).tenants || []);
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
      const body = {
        ...draft,
        tenant_name: draft.tenant_name.trim(),
        company_name: draft.company_name.trim(),
        max_users: Number(draft.max_users),
        max_systems: Number(draft.max_systems),
      };
      if (draft.tenant_id) body.tenant_id = Number(draft.tenant_id);
      else delete body.tenant_id;
      for (const field of ['primary_address', 'phone', 'contact_email', 'primary_contact_name', 'billing_contact_name', 'billing_contact_email', 'contract_start_date', 'contract_end_date', 'notes']) {
        if (!body[field]) body[field] = null;
      }
      const response = await authFetch(token, '/api/admin/tenants', { method: 'POST', body: JSON.stringify(body) });
      if (!response.ok) throw new Error(await readError(response, 'Could not create the tenant.'));
      setDraft({ tenant_name: '', company_name: '', primary_address: '', phone: '', contact_email: '', primary_contact_name: '', billing_contact_name: '', billing_contact_email: '', max_users: '10', max_systems: '50', contract_start_date: '', contract_end_date: '', notes: '', tenant_id: '' });
      setOnboardOpen(false);
      onNotice(`Created ${body.company_name}.`);
      load();
    } catch (error) { onError(error.message); }
  };

  const uniqueTenants = [...new Map(tenants.map((row) => [row.tenant_id, row])).values()];

  return (
    <div className="admin-panel">
      <div className="admin-panel__heading"><span><Building2 size={16} /> Tenant directory</span><button className="icon-button" type="button" onClick={load} aria-label="Refresh tenants"><RefreshCw size={14} /></button></div>
      <div className="admin-toolbar"><span>Organizations registered with Core</span><button className="primary-button" type="button" onClick={() => setOnboardOpen(true)}><Building2 size={15} /> Onboard tenant</button></div>
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
      {onboardOpen && <div className="modal-backdrop tenant-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOnboardOpen(false); }}>
        <section className="tenant-onboard-modal" role="dialog" aria-modal="true" aria-labelledby="tenant-onboard-title">
          <div className="tenant-onboard-modal__header"><div><p className="eyebrow">Organization setup</p><h2 id="tenant-onboard-title">Onboard new tenant</h2></div><button className="icon-button" type="button" onClick={() => setOnboardOpen(false)} aria-label="Cancel onboarding">×</button></div>
          <form className="tenant-onboard-form" onSubmit={createTenant}>
            <fieldset><legend>Basic information</legend><div className="tenant-onboard-grid">
              <label>Tenant name <span className="required-mark">*</span><input value={draft.tenant_name} onChange={(e) => setDraft({ ...draft, tenant_name: e.target.value })} placeholder="e.g. acme-corp" required /></label>
              <label>Company name <span className="required-mark">*</span><input value={draft.company_name} onChange={(e) => setDraft({ ...draft, company_name: e.target.value })} placeholder="e.g. ACME Corporation" required /></label>
              <label>Tenant ID <small>Optional; use an existing product ID to link records</small><input inputMode="numeric" min="1" value={draft.tenant_id} onChange={(e) => setDraft({ ...draft, tenant_id: e.target.value })} placeholder="Assigned automatically" /></label>
            </div></fieldset>
            <fieldset><legend>Contact information</legend><div className="tenant-onboard-grid">
              <label>Contact email<input type="email" value={draft.contact_email} onChange={(e) => setDraft({ ...draft, contact_email: e.target.value })} placeholder="contact@company.com" /></label>
              <label>Phone<input type="tel" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} placeholder="+1 555 123 4567" /></label>
              <label>Primary contact<input value={draft.primary_contact_name} onChange={(e) => setDraft({ ...draft, primary_contact_name: e.target.value })} placeholder="Contact name" /></label>
              <label className="tenant-onboard-grid__wide">Address<input value={draft.primary_address} onChange={(e) => setDraft({ ...draft, primary_address: e.target.value })} placeholder="Street, city, region, postal code" /></label>
            </div></fieldset>
            <fieldset><legend>Billing information</legend><div className="tenant-onboard-grid">
              <label>Billing contact<input value={draft.billing_contact_name} onChange={(e) => setDraft({ ...draft, billing_contact_name: e.target.value })} placeholder="Billing contact" /></label>
              <label>Billing email<input type="email" value={draft.billing_contact_email} onChange={(e) => setDraft({ ...draft, billing_contact_email: e.target.value })} placeholder="billing@company.com" /></label>
            </div></fieldset>
            <fieldset><legend>Capacity and contract</legend><div className="tenant-onboard-grid">
              <label>Maximum users <span className="required-mark">*</span><input type="number" min="1" max="10000" value={draft.max_users} onChange={(e) => setDraft({ ...draft, max_users: e.target.value })} required /></label>
              <label>Maximum systems / devices <span className="required-mark">*</span><input type="number" min="1" max="100000" value={draft.max_systems} onChange={(e) => setDraft({ ...draft, max_systems: e.target.value })} required /></label>
              <label>Contract start date<input type="date" value={draft.contract_start_date} onChange={(e) => setDraft({ ...draft, contract_start_date: e.target.value })} /></label>
              <label>Contract end date<input type="date" value={draft.contract_end_date} onChange={(e) => setDraft({ ...draft, contract_end_date: e.target.value })} /></label>
              <label className="tenant-onboard-grid__wide">Notes<textarea rows={3} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="Internal notes" /></label>
            </div></fieldset>
            <div className="tenant-onboard-modal__actions"><button className="quiet-button" type="button" onClick={() => setOnboardOpen(false)}>Cancel</button><button className="primary-button" type="submit"><Building2 size={15} /> OK · Create tenant</button></div>
          </form>
        </section>
      </div>}
    </div>
  );
}

function SubscriptionsPanel({ token, onError, onNotice }) {
  const [tenants, setTenants] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(false);
  const [assignment, setAssignment] = useState({ tenant_id: '', plan_key: '' });
  const [planDraft, setPlanDraft] = useState({ product_key: '', plan_key: '', display_name: '', price_monthly: '', max_users: '', max_systems: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tenantResponse, catalogResponse] = await Promise.all([
        authFetch(token, '/api/admin/tenants'),
        authFetch(token, '/api/admin/catalog'),
      ]);
      if (!tenantResponse.ok) throw new Error(await readError(tenantResponse, 'Could not load tenants.'));
      if (!catalogResponse.ok) throw new Error(await readError(catalogResponse, 'Could not load the product catalog.'));
      setTenants((await tenantResponse.json()).tenants || []);
      setCatalog(((await catalogResponse.json()).entries || []).filter((entry) => entry.plan_key));
    } catch (error) {
      onError(error.message);
    } finally {
      setLoading(false);
    }
  }, [token, onError]);

  useEffect(() => { load(); }, [load]);

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
      setAssignment({ tenant_id: '', plan_key: '' });
      load();
    } catch (error) { onError(error.message); }
  };

  const uniqueTenants = [...new Map(tenants.map((row) => [row.tenant_id, row])).values()];
  const products = [...new Map(catalog.map((entry) => [entry.product_key, entry])).values()];

  const savePlan = async (event) => {
    event.preventDefault();
    if (!planDraft.product_key || !planDraft.plan_key || !planDraft.display_name) {
      onError('Choose a product and enter a plan key and display name.');
      return;
    }
    const body = {
      display_name: planDraft.display_name,
      price_monthly: planDraft.price_monthly === '' ? null : Number(planDraft.price_monthly),
      max_users: planDraft.max_users === '' ? null : Number(planDraft.max_users),
      max_systems: planDraft.max_systems === '' ? null : Number(planDraft.max_systems),
    };
    try {
      const response = await authFetch(token, `/api/admin/catalog/${encodeURIComponent(planDraft.product_key)}/plans/${encodeURIComponent(planDraft.plan_key)}`, {
        method: 'PUT', body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await readError(response, 'Could not save the plan.'));
      onNotice(`Saved ${planDraft.display_name}.`);
      setPlanDraft({ product_key: '', plan_key: '', display_name: '', price_monthly: '', max_users: '', max_systems: '' });
      load();
    } catch (error) { onError(error.message); }
  };

  return (
    <div className="admin-panel">
      <div className="admin-panel__heading"><span><Package size={16} /> Plans and subscriptions</span><button className="icon-button" type="button" onClick={load} aria-label="Refresh plans"><RefreshCw size={14} /></button></div>
      <form className="admin-form" onSubmit={savePlan}>
        <label>Product<select value={planDraft.product_key} onChange={(e) => setPlanDraft({ ...planDraft, product_key: e.target.value })}><option value="">Select…</option>{products.map((product) => <option key={product.product_key} value={product.product_key}>{product.product_name}</option>)}</select></label>
        <label>Plan key<input value={planDraft.plan_key} onChange={(e) => setPlanDraft({ ...planDraft, plan_key: e.target.value.trim().toLowerCase() })} placeholder="starter" required /></label>
        <label>Display name<input value={planDraft.display_name} onChange={(e) => setPlanDraft({ ...planDraft, display_name: e.target.value })} required /></label>
        <label>Monthly price<input type="number" min="0" step="0.01" value={planDraft.price_monthly} onChange={(e) => setPlanDraft({ ...planDraft, price_monthly: e.target.value })} placeholder="Not set" /></label>
        <label>User limit<input type="number" min="0" step="1" value={planDraft.max_users} onChange={(e) => setPlanDraft({ ...planDraft, max_users: e.target.value })} placeholder="Not set" /></label>
        <label>System limit<input type="number" min="0" step="1" value={planDraft.max_systems} onChange={(e) => setPlanDraft({ ...planDraft, max_systems: e.target.value })} placeholder="Not set" /></label>
        <button className="primary-button" type="submit"><Package size={15} /> Save plan</button>
      </form>
      <form className="admin-form" onSubmit={assignPlan}>
        <label>Tenant<select value={assignment.tenant_id} onChange={(e) => setAssignment({ ...assignment, tenant_id: e.target.value })}><option value="">Select…</option>{uniqueTenants.map((tenant) => <option key={tenant.tenant_id} value={tenant.tenant_id}>{tenant.display_name}</option>)}</select></label>
        <label>Product plan<select value={assignment.plan_key} onChange={(e) => setAssignment({ ...assignment, plan_key: e.target.value })}><option value="">Select…</option>{catalog.map((entry) => <option key={`${entry.product_key}::${entry.plan_key}`} value={`${entry.product_key}::${entry.plan_key}`}>{entry.product_name} · {entry.plan_name}</option>)}</select></label>
        <button className="primary-button" type="submit"><Package size={15} /> Assign plan</button>
      </form>
      {loading ? <p className="admin-empty">Loading subscriptions…</p> : (
        <table className="admin-table">
          <thead><tr><th>Tenant</th><th>Product</th><th>Plan</th><th>State</th><th>Members</th></tr></thead>
          <tbody>{tenants.filter((row) => row.product_key).map((row) => (
            <tr key={`${row.tenant_id}-${row.product_key}`}>
              <td><strong>{row.display_name}</strong><small>#{row.tenant_id}</small></td>
              <td>{row.product_key}</td>
              <td>{row.plan_key}</td>
              <td><span className={row.entitlement_status === 'active' ? 'admin-pill admin-pill--good' : 'admin-pill'}>{row.entitlement_status}</span></td>
              <td>{row.member_count}</td>
            </tr>
          ))}{!tenants.some((row) => row.product_key) && <tr><td colSpan={5} className="admin-empty">No product subscriptions assigned.</td></tr>}</tbody>
        </table>
      )}
    </div>
  );
}

export default function AdminConsole({ token }) {
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [activeTab, setActiveTab] = useState(() => {
    const requested = window.location.hash.split('/')[1];
    return ['tenants', 'users', 'plans'].includes(requested) ? requested : 'tenants';
  });

  const report = (message) => { setError(message); setNotice(''); };
  const announce = (message) => { setNotice(message); setError(''); };

  useEffect(() => {
    const syncTab = () => {
      const requested = window.location.hash.split('/')[1];
      if (['tenants', 'users', 'plans'].includes(requested)) setActiveTab(requested);
    };
    window.addEventListener('hashchange', syncTab);
    return () => window.removeEventListener('hashchange', syncTab);
  }, []);

  const selectTab = (tab) => {
    setActiveTab(tab);
    if (window.location.hash !== `#admin/${tab}`) window.location.hash = `admin/${tab}`;
  };

  return (
    <section className="admin-console" aria-label="Platform administration">
      <div className="admin-page-heading">
        <div><a className="admin-back-link" href="#projects">← Workspace</a><p className="eyebrow">Core control plane</p><h1>Administration</h1></div>
        <p>Manage suite accounts, organizations, and product access.</p>
      </div>
      {error && <p className="admin-alert admin-alert--error" role="alert"><KeyRound size={14} /> {error}</p>}
      {notice && <p className="admin-alert" role="status">{notice}</p>}
      <div className="admin-tabs" role="tablist" aria-label="Administration sections">
        {[
          { id: 'tenants', label: 'Tenants' },
          { id: 'users', label: 'Users' },
          { id: 'plans', label: 'Plans' },
        ].map((tab) => <button key={tab.id} className={activeTab === tab.id ? 'admin-tab admin-tab--active' : 'admin-tab'} id={`admin-tab-${tab.id}`} type="button" role="tab" aria-selected={activeTab === tab.id} aria-controls="admin-tab-panel" onClick={() => selectTab(tab.id)}>{tab.label}</button>)}
      </div>
      <div className="admin-tab-panel" id="admin-tab-panel" role="tabpanel" aria-labelledby={`admin-tab-${activeTab}`}>
        {activeTab === 'tenants' && <TenantsPanel token={token} onError={report} onNotice={announce} />}
        {activeTab === 'users' && <UsersPanel token={token} onError={report} onNotice={announce} />}
        {activeTab === 'plans' && <SubscriptionsPanel token={token} onError={report} onNotice={announce} />}
      </div>
    </section>
  );
}
