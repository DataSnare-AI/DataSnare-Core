import { useCallback, useEffect, useState } from 'react';
import { Building2, Check, Cloud, Info, KeyRound, Package, Plus, RefreshCw, Save, UserPlus, Users, X } from 'lucide-react';
import { PlanTag } from './adminTags';

const ROLES = ['viewer', 'operator', 'approver', 'tenant_admin', 'platform_admin'];

function Dialog({ title, eyebrow, onClose, children, actions, wide = false }) {
  return <div className="modal-backdrop admin-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={`admin-dialog${wide ? ' admin-dialog--wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
      <header className="admin-dialog__header"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close"><X size={17} /></button></header>
      {children}
      <footer className="admin-dialog__actions">{actions}</footer>
    </section>
  </div>;
}

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
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
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

  const openCreate = () => {
    setEditingUser(null);
    setDraft({ username: '', display_name: '', email: '', password: '', global_role: 'viewer' });
    setDialogOpen(true);
  };

  const openEdit = (user) => {
    setEditingUser(user);
    setDraft({ username: user.username, display_name: user.display_name || '', email: user.email || '', password: '', global_role: user.global_role || 'viewer' });
    setDialogOpen(true);
  };

  const saveUser = async (event) => {
    event.preventDefault();
    try {
      let response;
      if (editingUser) {
        const body = { display_name: draft.display_name, email: draft.email, global_role: draft.global_role };
        if (draft.password) body.password = draft.password;
        response = await authFetch(token, `/api/admin/users/${encodeURIComponent(editingUser.username)}`, { method: 'PATCH', body: JSON.stringify(body) });
      } else {
        const body = { ...draft };
        if (!body.password) delete body.password;
        response = await authFetch(token, '/api/admin/users', { method: 'POST', body: JSON.stringify(body) });
      }
      if (!response.ok) throw new Error(await readError(response, editingUser ? 'Could not update the user.' : 'Could not create the user.'));
      onNotice(`${editingUser ? 'Updated' : 'Created'} ${draft.username}.`);
      setDialogOpen(false);
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
      <div className="admin-panel__heading"><span><Users size={16} /> Users</span><div className="admin-heading-actions"><button className="admin-secondary-button" type="button" onClick={openCreate}><Plus size={14} /> New User</button><button className="icon-button" type="button" onClick={load} aria-label="Refresh users"><RefreshCw size={14} /></button></div></div>
      {loading ? <p className="admin-empty">Loading users…</p> : (
        <table className="admin-table">
          <thead><tr><th>User</th><th>Email</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.username}>
                <td><strong>{user.display_name || user.username}</strong><small>{user.username}{user.source_system === 'aiops' ? ' · imported' : ''}</small></td>
                <td>{user.email || <span className="admin-empty">—</span>}</td>
                <td><span className={`admin-pill admin-pill--role admin-pill--role-${user.global_role}`}>{user.global_role}</span></td>
                <td>{user.invite_pending ? <span className="admin-pill admin-pill--warn">invite pending</span> : <span className={user.is_active ? 'admin-pill admin-pill--good' : 'admin-pill'}>{user.is_active ? 'active' : 'disabled'}</span>}</td>
                <td><div className="admin-row-actions"><button className="quiet-button quiet-button--small" type="button" onClick={() => openEdit(user)}>Edit</button><button className="quiet-button quiet-button--small" type="button" onClick={() => patchUser(user.username, { is_active: !user.is_active }, `${user.is_active ? 'Disabled' : 'Enabled'} ${user.username}.`)}>{user.is_active ? 'Disable' : 'Enable'}</button></div></td>
              </tr>
            ))}
            {!users.length && <tr><td colSpan={5} className="admin-empty">No users yet.</td></tr>}
          </tbody>
        </table>
      )}
      {dialogOpen && <Dialog title={editingUser ? 'Update User' : 'Add User'} eyebrow="Account administration" onClose={() => setDialogOpen(false)} actions={<><button className="quiet-button" type="button" onClick={() => setDialogOpen(false)}>Cancel</button><button className="primary-button" type="submit" form="core-user-form"><Check size={15} /> OK</button></>}>
        <form id="core-user-form" className="admin-dialog__form" onSubmit={saveUser}>
          <label>Username<input value={draft.username} onChange={(e) => setDraft({ ...draft, username: e.target.value })} required disabled={Boolean(editingUser)} autoComplete="username" /></label>
          <label>Display name<input value={draft.display_name} onChange={(e) => setDraft({ ...draft, display_name: e.target.value })} /></label>
          <label>Email<input type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} autoComplete="email" /></label>
          <label>Password<input type="password" minLength={12} value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} placeholder={editingUser ? 'Leave blank to keep current password' : 'Leave blank for invitation setup'} autoComplete="new-password" /></label>
          <label>Role<select value={draft.global_role} onChange={(e) => setDraft({ ...draft, global_role: e.target.value })}>{ROLES.map((role) => <option key={role} value={role}>{role}</option>)}</select><span className={`admin-pill admin-pill--role admin-pill--role-${draft.global_role}`}>{draft.global_role.replace('_', ' ')}</span></label>
        </form>
      </Dialog>}
    </div>
  );
}

function TenantsPanel({ token, onError, onNotice }) {
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(false);
  const [onboardOpen, setOnboardOpen] = useState(false);
  const [memberTenant, setMemberTenant] = useState(null);
  const [members, setMembers] = useState([]);
  const [memberUsers, setMemberUsers] = useState([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [memberDraft, setMemberDraft] = useState({ actor_id: '', role_key: 'viewer' });
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

  const loadMembers = useCallback(async (tenantId) => {
    setMembersLoading(true);
    try {
      const [membersResponse, usersResponse] = await Promise.all([
        authFetch(token, `/api/admin/tenants/${tenantId}/members`),
        authFetch(token, '/api/admin/users'),
      ]);
      if (!membersResponse.ok) throw new Error(await readError(membersResponse, 'Could not load tenant members.'));
      if (!usersResponse.ok) throw new Error(await readError(usersResponse, 'Could not load Core users.'));
      setMembers((await membersResponse.json()).members || []);
      setMemberUsers(((await usersResponse.json()).users || []).filter((user) => user.is_active));
    } catch (error) { onError(error.message); }
    finally { setMembersLoading(false); }
  }, [token, onError]);

  const openMembers = (tenant) => {
    setMemberTenant(tenant);
    setMemberDraft({ actor_id: '', role_key: 'viewer' });
    loadMembers(tenant.tenant_id);
  };

  const assignMember = async (event) => {
    event.preventDefault();
    if (!memberTenant || !memberDraft.actor_id) { onError('Choose a user to add.'); return; }
    try {
      const response = await authFetch(token, `/api/admin/tenants/${memberTenant.tenant_id}/members`, {
        method: 'PUT', body: JSON.stringify(memberDraft),
      });
      if (!response.ok) throw new Error(await readError(response, 'Could not assign the tenant role.'));
      onNotice(`Assigned ${memberDraft.role_key} to ${memberDraft.actor_id} for ${memberTenant.display_name}.`);
      setMemberDraft({ actor_id: '', role_key: 'viewer' });
      loadMembers(memberTenant.tenant_id);
      load();
    } catch (error) { onError(error.message); }
  };

  const deactivateMember = async (actorId) => {
    try {
      const response = await authFetch(token, `/api/admin/tenants/${memberTenant.tenant_id}/members/${encodeURIComponent(actorId)}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(await readError(response, 'Could not remove the tenant member.'));
      onNotice(`Removed ${actorId} from ${memberTenant.display_name}.`);
      loadMembers(memberTenant.tenant_id);
      load();
    } catch (error) { onError(error.message); }
  };

  const groupedTenants = [...tenants.reduce((groups, row) => {
    const tenant = groups.get(row.tenant_id) || { ...row, products: [], plans: [] };
    if (row.product_key) {
      tenant.products.push({
      product_key: row.product_key,
      product_name: row.product_name || row.product_key,
      entitlement_status: row.entitlement_status,
      });
      tenant.plans.push({
        product_key: row.product_key,
        plan_key: row.plan_key,
        plan_name: row.plan_name || row.plan_key,
      });
    }
    groups.set(row.tenant_id, tenant);
    return groups;
  }, new Map()).values()];

  return (
    <div className="admin-panel">
      <div className="admin-panel__heading"><span><Building2 size={16} /> Tenant directory</span><button className="icon-button" type="button" onClick={load} aria-label="Refresh tenants"><RefreshCw size={14} /></button></div>
      <div className="admin-toolbar"><span>Organizations registered with Core</span><button className="primary-button" type="button" onClick={() => setOnboardOpen(true)}><Building2 size={15} /> Onboard tenant</button></div>
      {loading ? <p className="admin-empty">Loading tenants…</p> : (
        <table className="admin-table">
          <thead><tr><th>Tenant</th><th>Products</th><th>Plan</th><th>Members</th><th>Actions</th></tr></thead>
          <tbody>
            {groupedTenants.map((row) => (
              <tr key={row.tenant_id}>
                <td><strong>{row.display_name}</strong><small>#{row.tenant_id}</small><span className={`admin-pill ${row.status === 'active' ? 'admin-pill--good' : 'admin-pill--bad'}`}>{row.status}</span></td>
                <td>{row.products.length ? <div className="tenant-product-stack">{row.products.map((product) => <div className="tenant-product-stack__row" key={product.product_key}><PlanTag planKey={product.product_key}>{product.product_name}</PlanTag></div>)}</div> : <span className="admin-pill admin-pill--warn">no products</span>}</td>
                <td>{row.plans.length ? <div className="tenant-product-stack">{row.plans.map((plan) => <div className="tenant-product-stack__row" key={`${plan.product_key}-${plan.plan_key}`}>{plan.plan_key ? <PlanTag planKey={plan.plan_key}>{plan.plan_name}</PlanTag> : <span className="admin-pill admin-pill--warn">no plan</span>}</div>)}</div> : <span className="admin-empty">—</span>}</td>
                <td>{row.member_count}</td>
                <td><button className="quiet-button quiet-button--small" type="button" onClick={() => openMembers(row)}>Manage Members</button></td>
              </tr>
            ))}
            {!groupedTenants.length && <tr><td colSpan={5} className="admin-empty">No tenants yet.</td></tr>}
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
      {memberTenant && <Dialog title={`Members · ${memberTenant.display_name}`} eyebrow={`Tenant #${memberTenant.tenant_id}`} onClose={() => setMemberTenant(null)} wide actions={<button className="quiet-button" type="button" onClick={() => setMemberTenant(null)}>Close</button>}>
        <form className="admin-dialog__form member-assignment-form" onSubmit={assignMember}>
          <label>User<select value={memberDraft.actor_id} onChange={(event) => setMemberDraft({ ...memberDraft, actor_id: event.target.value })} required><option value="">Select user…</option>{memberUsers.map((user) => <option key={user.username} value={user.username}>{user.display_name || user.username} · {user.username}</option>)}</select></label>
          <label>Tenant role<select value={memberDraft.role_key} onChange={(event) => setMemberDraft({ ...memberDraft, role_key: event.target.value })}>{ROLES.filter((role) => role !== 'platform_admin').map((role) => <option key={role} value={role}>{role.replace('_', ' ')}</option>)}</select><span className={`admin-pill admin-pill--role admin-pill--role-${memberDraft.role_key}`}>{memberDraft.role_key.replace('_', ' ')}</span></label>
          <button className="primary-button" type="submit"><UserPlus size={15} /> Assign role</button>
        </form>
        {membersLoading ? <p className="admin-empty">Loading members…</p> : <div className="admin-dialog__table-wrap"><table className="admin-table"><thead><tr><th>Member</th><th>Tenant role</th><th>Identity</th><th>Status</th><th>Actions</th></tr></thead><tbody>
          {members.map((member) => <tr key={`${member.identity_issuer}-${member.identity_subject}`}><td><strong>{member.display_name || member.actor_id}</strong><small>{member.actor_id}</small></td><td><span className={`admin-pill admin-pill--role admin-pill--role-${member.role_key}`}>{member.role_key.replace('_', ' ')}</span></td><td><small>{member.identity_issuer}</small></td><td><span className={`admin-pill ${member.status === 'active' && member.user_active !== false ? 'admin-pill--good' : 'admin-pill--bad'}`}>{member.user_active === false ? 'user disabled' : member.status}</span></td><td>{member.status === 'active' && <button className="quiet-button quiet-button--small" type="button" onClick={() => deactivateMember(member.actor_id)}>Remove</button>}</td></tr>)}
          {!members.length && <tr><td colSpan={5} className="admin-empty">No tenant members assigned.</td></tr>}
        </tbody></table></div>}
      </Dialog>}
    </div>
  );
}

function SubscriptionsPanel({ token, onError, onNotice }) {
  const [tenants, setTenants] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(false);
  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState(null);
  const [planDraft, setPlanDraft] = useState({ product_key: '', plan_key: '', display_name: '', description: '', price_monthly: '', max_users: '', max_systems: '', is_active: true });
  const [productDialogOpen, setProductDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [productDraft, setProductDraft] = useState({ display_name: '', description: '', is_active: true });
  const [assignment, setAssignment] = useState(null);
  const [assignmentDraft, setAssignmentDraft] = useState({ plan_key: '', status: 'active', max_users: '', max_systems: '', effective_start_date: '', effective_end_date: '' });

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
      setCatalog((await catalogResponse.json()).entries || []);
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
  const plans = catalog.filter((entry) => entry.plan_key);
  const productGroups = products.map((product) => ({
    ...product,
    plans: plans.filter((plan) => plan.product_key === product.product_key),
  }));

  const savePlan = async (event) => {
    event.preventDefault();
    if (!planDraft.product_key || !planDraft.plan_key || !planDraft.display_name) {
      onError('Choose a product and enter a plan key and display name.');
      return;
    }
    const body = {
      display_name: planDraft.display_name,
        description: planDraft.description || null,
      price_monthly: planDraft.price_monthly === '' ? null : Number(planDraft.price_monthly),
      max_users: planDraft.max_users === '' ? null : Number(planDraft.max_users),
      max_systems: planDraft.max_systems === '' ? null : Number(planDraft.max_systems),
        is_active: planDraft.is_active,
    };
    try {
      const response = await authFetch(token, `/api/admin/catalog/${encodeURIComponent(planDraft.product_key)}/plans/${encodeURIComponent(planDraft.plan_key)}`, {
        method: 'PUT', body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await readError(response, 'Could not save the plan.'));
      onNotice(`Saved ${planDraft.display_name}.`);
      setPlanDialogOpen(false);
      setEditingPlan(null);
      load();
    } catch (error) { onError(error.message); }
  };

  const openNewPlan = () => {
    setEditingPlan(null);
    setPlanDraft({ product_key: '', plan_key: '', display_name: '', description: '', price_monthly: '', max_users: '', max_systems: '', is_active: true });
    setPlanDialogOpen(true);
  };

  const openEditPlan = (plan) => {
    setEditingPlan(plan);
    setPlanDraft({
      product_key: plan.product_key,
      plan_key: plan.plan_key,
      display_name: plan.plan_name || '',
      description: plan.plan_description || '',
      price_monthly: plan.price_monthly ?? '',
      max_users: plan.entitlements?.max_users ?? '',
      max_systems: plan.entitlements?.max_systems ?? '',
      is_active: plan.plan_active !== false,
    });
    setPlanDialogOpen(true);
  };

  const openEditProduct = (product) => {
    setEditingProduct(product);
    setProductDraft({ display_name: product.product_name || '', description: product.product_description || '', is_active: product.product_active !== false });
    setProductDialogOpen(true);
  };

  const saveProduct = async (event) => {
    event.preventDefault();
    if (!editingProduct || !productDraft.display_name.trim()) { onError('Product display name is required.'); return; }
    try {
      const response = await authFetch(token, `/api/admin/catalog/${encodeURIComponent(editingProduct.product_key)}`, {
        method: 'PATCH', body: JSON.stringify({ ...productDraft, display_name: productDraft.display_name.trim(), description: productDraft.description || null }),
      });
      if (!response.ok) throw new Error(await readError(response, 'Could not update the product.'));
      onNotice(`Updated ${productDraft.display_name}.`);
      setProductDialogOpen(false);
      setEditingProduct(null);
      load();
    } catch (error) { onError(error.message); }
  };

  const openAssignment = (tenant, productKey = '') => {
    const key = productKey || 'aiops';
    const current = tenants.find((entry) => entry.tenant_id === tenant.tenant_id && entry.product_key === key);
    setAssignment({ tenant_id: tenant.tenant_id, tenant_name: tenant.display_name, product_key: key });
    setAssignmentDraft({
      plan_key: current?.plan_key || '',
      status: current?.entitlement_status || 'active',
      max_users: current?.limits_override?.max_users ?? '',
      max_systems: current?.limits_override?.max_systems ?? '',
      effective_start_date: current?.effective_start_date || '',
      effective_end_date: current?.effective_end_date || '',
    });
  };

  const saveAssignment = async (event) => {
    event.preventDefault();
    if (!assignment || !assignmentDraft.plan_key) { onError('Select a plan.'); return; }
    const body = {
      product_key: assignment.product_key,
      plan_key: assignmentDraft.plan_key,
      status: assignmentDraft.status,
      effective_start_date: assignmentDraft.effective_start_date || null,
      effective_end_date: assignmentDraft.effective_end_date || null,
      max_users: assignmentDraft.max_users === '' ? null : Number(assignmentDraft.max_users),
      max_systems: assignmentDraft.max_systems === '' ? null : Number(assignmentDraft.max_systems),
    };
    try {
      const response = await authFetch(token, `/api/admin/tenants/${assignment.tenant_id}/entitlements`, { method: 'PUT', body: JSON.stringify(body) });
      if (!response.ok) throw new Error(await readError(response, 'Could not assign the plan.'));
      onNotice(`Assigned ${body.plan_key} to ${assignment.tenant_name}.`);
      setAssignment(null);
      load();
    } catch (error) { onError(error.message); }
  };

  return (
    <div className="plans-workspace">
      <section className="admin-panel plans-section">
        <div className="admin-panel__heading"><span>Plans</span><div className="admin-heading-actions"><button className="admin-secondary-button" type="button" onClick={openNewPlan}><Plus size={14} /> New / Update Plan</button><button className="icon-button" type="button" onClick={load} aria-label="Refresh plans"><RefreshCw size={14} /></button></div></div>
        <div className="plan-info"><Info size={18} /><div><strong>Plan limits drive tenant allocation</strong><p>Assigning a plan sets a tenant’s user and system limits. Tenant-specific overrides take precedence. System usage is not yet synchronized into Core.</p></div></div>
        {loading ? <p className="admin-empty">Loading plans…</p> : <div className="product-plan-groups">{productGroups.map((product) => <section className="product-plan-group" key={product.product_key}>
          <header className="product-plan-group__header"><div className="product-plan-group__identity"><PlanTag planKey={product.product_key}>{product.product_key}</PlanTag><div><h3>{product.product_name}</h3><small>{product.product_description || 'Product description not set'}</small></div></div><div className="product-plan-group__actions"><span className={`admin-pill ${product.product_active ? 'admin-pill--good' : 'admin-pill--bad'}`}>{product.product_active ? 'active' : 'inactive'}</span><button className="quiet-button quiet-button--small" type="button" onClick={() => openEditProduct(product)}>Edit product</button></div></header>
          {product.plans.length ? <div className="admin-table-scroll"><table className="admin-table plans-table"><colgroup><col className="plans-col-tier" /><col className="plans-col-name" /><col className="plans-col-users" /><col className="plans-col-systems" /><col className="plans-col-price" /><col className="plans-col-status" /><col className="plans-col-actions" /></colgroup><thead><tr><th>Plan</th><th>Name</th><th>Users</th><th>Systems</th><th>Price</th><th>Status</th><th>Actions</th></tr></thead><tbody>{product.plans.map((plan) => <tr key={`${plan.product_key}-${plan.plan_key}`}>
            <td><PlanTag planKey={plan.plan_key}>{plan.plan_key}</PlanTag></td><td><strong>{plan.plan_name}</strong><small>{plan.plan_description || 'Purpose not set'}</small></td>
            <td>{plan.entitlements?.max_users ?? '—'}</td><td>{plan.entitlements?.max_systems ?? '—'}</td>
            <td>{plan.price_monthly == null ? '—' : `${plan.currency === 'USD' ? '$' : `${plan.currency} `}${plan.price_monthly}`}{plan.price_monthly != null && <small>/ month</small>}</td>
            <td><span className={`admin-pill ${plan.plan_active ? 'admin-pill--good' : 'admin-pill--bad'}`}>{plan.plan_active ? 'active' : 'inactive'}</span></td>
            <td><button className="quiet-button quiet-button--small" type="button" onClick={() => openEditPlan(plan)}>Edit</button></td>
          </tr>)}</tbody></table></div> : <p className="product-plan-group__empty">No plans configured for this product.</p>}
        </section>)}</div>}
      </section>

      <section className="admin-panel assignments-section">
        <div className="admin-panel__heading"><span>Tenant Plan Assignments</span></div>
        {loading ? <p className="admin-empty">Loading assignments…</p> : <div className="admin-table-scroll"><table className="admin-table assignments-table">
          <thead><tr><th>Tenant</th><th>Plan</th><th>Users</th><th>Systems</th><th>Allocation</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>{tenants.filter((row) => row.product_key).map((row) => {
            const plan = catalog.find((entry) => entry.product_key === row.product_key && entry.plan_key === row.plan_key);
            const userLimit = row.limits_override?.max_users ?? plan?.entitlements?.max_users;
            const systemLimit = row.limits_override?.max_systems ?? plan?.entitlements?.max_systems;
            const usersUsed = Number(row.member_count || 0);
            const userOver = userLimit != null && usersUsed > userLimit;
            const systemKnown = row.systems_in_use != null;
            const allocation = userOver ? ['admin-pill--bad', 'Over user allocation'] : userLimit == null || systemLimit == null ? ['admin-pill--warn', 'Needs allocation'] : ['admin-pill--good', 'Within allocation'];
            return <tr key={`${row.tenant_id}-${row.product_key}`}>
              <td><strong>{row.display_name}</strong></td>
              <td><PlanTag planKey={row.plan_key}>{row.plan_key}</PlanTag></td>
              <td className={userOver ? 'allocation-over' : ''}>{usersUsed} / {userLimit ?? '—'}</td>
              <td>{systemKnown ? `${row.systems_in_use} / ${systemLimit ?? '—'}` : `— / ${systemLimit ?? '—'}`}</td>
              <td><span className={`admin-pill ${allocation[0]}`}>{allocation[1]}</span></td>
              <td><span className={`admin-pill ${row.entitlement_status === 'active' ? 'admin-pill--good' : 'admin-pill--bad'}`}>{row.entitlement_status || 'unknown'}</span></td>
              <td><button className="quiet-button quiet-button--small" type="button" onClick={() => openAssignment(row)}>Assign Plan</button></td>
            </tr>;
          })}{!tenants.some((row) => row.product_key) && <tr><td colSpan={7} className="admin-empty">No tenant plan assignments.</td></tr>}</tbody>
        </table></div>}
      </section>

      {planDialogOpen && <Dialog title={editingPlan ? 'Update Subscription Plan' : 'New Subscription Plan'} eyebrow="Product catalog" onClose={() => setPlanDialogOpen(false)} actions={<><button className="quiet-button" type="button" onClick={() => setPlanDialogOpen(false)}>Cancel</button><button className="primary-button" type="submit" form="core-plan-form"><Check size={15} /> Save Plan</button></>}>
        <form id="core-plan-form" className="admin-dialog__form" onSubmit={savePlan}>
          {planDraft.plan_key && <div className="plan-dialog-preview"><PlanTag planKey={planDraft.plan_key}>{planDraft.plan_key}</PlanTag><span>{planDraft.description || 'Plan purpose has not been described yet.'}</span></div>}
          <label>Product<select value={planDraft.product_key} onChange={(event) => setPlanDraft({ ...planDraft, product_key: event.target.value })} disabled={Boolean(editingPlan)} required><option value="">Select product…</option>{products.map((product) => <option key={product.product_key} value={product.product_key}>{product.product_name}</option>)}</select></label>
          <label>Plan key<input value={planDraft.plan_key} onChange={(event) => setPlanDraft({ ...planDraft, plan_key: event.target.value.trim().toLowerCase() })} disabled={Boolean(editingPlan)} placeholder="starter" required /></label>
          <label>Display name<input value={planDraft.display_name} onChange={(event) => setPlanDraft({ ...planDraft, display_name: event.target.value })} placeholder="Starter" required /></label>
          <label>Description<textarea rows={3} value={planDraft.description} onChange={(event) => setPlanDraft({ ...planDraft, description: event.target.value })} placeholder="What this plan is intended for" /></label>
          <div className="admin-dialog__field-grid"><label>Maximum users<input type="number" min="0" value={planDraft.max_users} onChange={(event) => setPlanDraft({ ...planDraft, max_users: event.target.value })} placeholder="No limit set" /></label><label>Maximum systems<input type="number" min="0" value={planDraft.max_systems} onChange={(event) => setPlanDraft({ ...planDraft, max_systems: event.target.value })} placeholder="No limit set" /></label><label>Monthly price (USD)<input type="number" min="0" step="0.01" value={planDraft.price_monthly} onChange={(event) => setPlanDraft({ ...planDraft, price_monthly: event.target.value })} placeholder="Not set" /></label><label>Status<select value={String(planDraft.is_active)} onChange={(event) => setPlanDraft({ ...planDraft, is_active: event.target.value === 'true' })}><option value="true">Active</option><option value="false">Inactive</option></select></label></div>
        </form>
      </Dialog>}

      {productDialogOpen && <Dialog title="Update Product" eyebrow="Product catalog" onClose={() => setProductDialogOpen(false)} actions={<><button className="quiet-button" type="button" onClick={() => setProductDialogOpen(false)}>Cancel</button><button className="primary-button" type="submit" form="core-product-form"><Check size={15} /> Save Product</button></>}>
        <form id="core-product-form" className="admin-dialog__form" onSubmit={saveProduct}>
          <label>Product key<input value={editingProduct?.product_key || ''} disabled /></label>
          <label>Display name<input value={productDraft.display_name} onChange={(event) => setProductDraft({ ...productDraft, display_name: event.target.value })} required /></label>
          <label>Description<textarea rows={3} value={productDraft.description} onChange={(event) => setProductDraft({ ...productDraft, description: event.target.value })} /></label>
          <label>Status<select value={String(productDraft.is_active)} onChange={(event) => setProductDraft({ ...productDraft, is_active: event.target.value === 'true' })}><option value="true">Active</option><option value="false">Inactive</option></select><span className={`admin-pill ${productDraft.is_active ? 'admin-pill--good' : 'admin-pill--bad'}`}>{productDraft.is_active ? 'active' : 'inactive'}</span></label>
        </form>
      </Dialog>}

      {assignment && <Dialog title={`Assign Plan · ${assignment.tenant_name}`} eyebrow="Tenant product access" onClose={() => setAssignment(null)} actions={<><button className="quiet-button" type="button" onClick={() => setAssignment(null)}>Cancel</button><button className="primary-button" type="submit" form="core-assignment-form"><Check size={15} /> Save Assignment</button></>}>
        <form id="core-assignment-form" className="admin-dialog__form" onSubmit={saveAssignment}>
          <label>Plan<select value={assignmentDraft.plan_key} onChange={(event) => setAssignmentDraft({ ...assignmentDraft, plan_key: event.target.value })} required><option value="">Select plan…</option>{plans.filter((entry) => entry.product_key === assignment.product_key && entry.plan_active).map((entry) => <option key={entry.plan_key} value={entry.plan_key}>{entry.plan_name}</option>)}</select>{assignmentDraft.plan_key && <PlanTag planKey={assignmentDraft.plan_key}>{assignmentDraft.plan_key}</PlanTag>}</label>
          <div className="admin-dialog__field-grid"><label>User limit override<input type="number" min="0" value={assignmentDraft.max_users} onChange={(event) => setAssignmentDraft({ ...assignmentDraft, max_users: event.target.value })} placeholder="Use plan limit" /></label><label>System limit override<input type="number" min="0" value={assignmentDraft.max_systems} onChange={(event) => setAssignmentDraft({ ...assignmentDraft, max_systems: event.target.value })} placeholder="Use plan limit" /></label><label>Effective from<input type="date" value={assignmentDraft.effective_start_date} onChange={(event) => setAssignmentDraft({ ...assignmentDraft, effective_start_date: event.target.value })} /></label><label>Effective until<input type="date" value={assignmentDraft.effective_end_date} onChange={(event) => setAssignmentDraft({ ...assignmentDraft, effective_end_date: event.target.value })} /></label></div>
          <label>Status<select value={assignmentDraft.status} onChange={(event) => setAssignmentDraft({ ...assignmentDraft, status: event.target.value })}><option value="active">Active</option><option value="trial">Trial</option><option value="suspended">Suspended</option></select></label>
        </form>
      </Dialog>}
    </div>
  );
}

function StoragePanel({ token, onError, onNotice }) {
  const [settings, setSettings] = useState({
    backend: 'local', local_upload_dir: '', upload_max_bytes: 262144000,
    blob_prefix: 'core-artifacts', azure_container: '', azure_account_url: '',
    azure_connection_string: '', azure_account_key: '', azure_sas_token: '',
  });
  const [secretFlags, setSecretFlags] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [health, setHealth] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await authFetch(token, '/api/admin/storage');
      if (!response.ok) throw new Error(await readError(response, 'Could not load storage settings.'));
      const result = await response.json();
      setSecretFlags({
        azure_connection_string: result.has_azure_connection_string,
        azure_account_key: result.has_azure_account_key,
        azure_sas_token: result.has_azure_sas_token,
      });
      setSettings({
        backend: result.backend || 'local', local_upload_dir: result.local_upload_dir || '',
        upload_max_bytes: Number(result.upload_max_bytes || 262144000),
        blob_prefix: result.blob_prefix || 'core-artifacts', azure_container: result.azure_container || '',
        azure_account_url: result.azure_account_url || '', azure_connection_string: '',
        azure_account_key: '', azure_sas_token: '',
      });
    } catch (error) { onError(error.message); }
    finally { setLoading(false); }
  }, [token, onError]);

  useEffect(() => { load(); }, [load]);

  const update = (field, value) => setSettings((current) => ({ ...current, [field]: value }));

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const body = {
        ...settings,
        upload_max_bytes: Number(settings.upload_max_bytes),
        local_upload_dir: settings.local_upload_dir || null,
        azure_container: settings.azure_container || null,
        azure_account_url: settings.azure_account_url || null,
        azure_connection_string: settings.azure_connection_string || null,
        azure_account_key: settings.azure_account_key || null,
        azure_sas_token: settings.azure_sas_token || null,
      };
      const response = await authFetch(token, '/api/admin/storage', { method: 'PUT', body: JSON.stringify(body) });
      if (!response.ok) throw new Error(await readError(response, 'Could not save storage settings.'));
      onNotice('Artifact storage settings saved.');
      await load();
    } catch (error) { onError(error.message); }
    finally { setSaving(false); }
  };

  const testConnection = async () => {
    setTesting(true);
    try {
      const response = await authFetch(token, '/api/admin/storage/test', { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || 'Storage connection test failed.');
      setHealth(result);
      if (result.healthy) onNotice('Storage connection is healthy.');
      else onError(result.detail || 'Storage connection failed.');
    } catch (error) { setHealth(null); onError(error.message); }
    finally { setTesting(false); }
  };

  const setSecret = (field, label) => <label>{label}<input type="password" autoComplete="new-password" value={settings[field]} onChange={(event) => update(field, event.target.value)} placeholder={secretFlags[field] ? 'Stored securely; leave blank to keep current' : 'Optional'} /></label>;

  return <div className="admin-panel storage-panel">
    <div className="admin-panel__heading"><span><Cloud size={16} /> Artifact storage</span><div className="admin-heading-actions"><button className="admin-secondary-button" type="button" onClick={testConnection} disabled={testing || loading}>{testing ? 'Testing…' : 'Test connectivity'}</button><button className="icon-button" type="button" onClick={load} aria-label="Refresh storage settings"><RefreshCw size={14} /></button></div></div>
    <div className="plan-info"><Info size={18} /><div><strong>Core uses an isolated path in the configured storage account</strong><p>You may use the same Azure account and container as AIOps. Core stores objects below its own prefix and records tenant-scoped metadata in the Core database. Existing AIOps Help files are not moved or modified.</p></div></div>
    {health && <p className={`admin-storage-health ${health.healthy ? 'admin-storage-health--good' : 'admin-storage-health--bad'}`} role="status"><span className={`admin-pill ${health.healthy ? 'admin-pill--good' : 'admin-pill--bad'}`}>{health.healthy ? 'healthy' : 'attention'}</span> {health.detail}{health.container ? ` · ${health.container}` : ''}</p>}
    <form className="admin-storage-form" onSubmit={save}>
      <label>Storage backend<select value={settings.backend} onChange={(event) => update('backend', event.target.value)}><option value="local">Local filesystem</option><option value="azure_blob">Azure Blob Storage</option></select></label>
      <label>Maximum upload size (bytes)<input type="number" min="1024" max="5368709120" value={settings.upload_max_bytes} onChange={(event) => update('upload_max_bytes', event.target.value)} required /></label>
      {settings.backend === 'local' ? <label className="admin-storage-form__wide">Upload directory<input value={settings.local_upload_dir} onChange={(event) => update('local_upload_dir', event.target.value)} placeholder="/var/lib/datasnare-core/artifacts" /></label> : <>
        <label>Azure container<input value={settings.azure_container} onChange={(event) => update('azure_container', event.target.value)} placeholder="help-repository" required /></label>
        <label>Core blob prefix<input value={settings.blob_prefix} onChange={(event) => update('blob_prefix', event.target.value)} placeholder="core-artifacts" required /></label>
        <label className="admin-storage-form__wide">Azure account URL<input value={settings.azure_account_url} onChange={(event) => update('azure_account_url', event.target.value)} placeholder="https://account.blob.core.windows.net" /></label>
        {setSecret('azure_connection_string', 'Azure connection string')}
        {setSecret('azure_account_key', 'Azure account key')}
        {setSecret('azure_sas_token', 'Azure SAS token')}
        <p className="admin-storage-form__note">Leave all credential fields blank to use the Core host’s managed identity, or leave an existing secret blank to retain it. Credentials are encrypted in Core’s database.</p>
      </>}
      <div className="admin-storage-form__actions"><button className="primary-button" type="submit" disabled={saving || loading}><Save size={15} /> {saving ? 'Saving…' : 'Save storage settings'}</button></div>
    </form>
  </div>;
}

export default function AdminConsole({ token }) {
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [activeTab, setActiveTab] = useState(() => {
    const requested = window.location.hash.split('/')[1];
    return ['tenants', 'users', 'plans', 'storage'].includes(requested) ? requested : 'tenants';
  });

  const report = useCallback((message) => { setError(message); setNotice(''); }, []);
  const announce = useCallback((message) => { setNotice(message); setError(''); }, []);

  useEffect(() => {
    const syncTab = () => {
      const requested = window.location.hash.split('/')[1];
      if (['tenants', 'users', 'plans', 'storage'].includes(requested)) setActiveTab(requested);
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
          { id: 'storage', label: 'Storage' },
        ].map((tab) => <button key={tab.id} className={activeTab === tab.id ? 'admin-tab admin-tab--active' : 'admin-tab'} id={`admin-tab-${tab.id}`} type="button" role="tab" aria-selected={activeTab === tab.id} aria-controls="admin-tab-panel" onClick={() => selectTab(tab.id)}>{tab.label}</button>)}
      </div>
      <div className="admin-tab-panel" id="admin-tab-panel" role="tabpanel" aria-labelledby={`admin-tab-${activeTab}`}>
        {activeTab === 'tenants' && <TenantsPanel token={token} onError={report} onNotice={announce} />}
        {activeTab === 'users' && <UsersPanel token={token} onError={report} onNotice={announce} />}
        {activeTab === 'plans' && <SubscriptionsPanel token={token} onError={report} onNotice={announce} />}
        {activeTab === 'storage' && <StoragePanel token={token} onError={report} onNotice={announce} />}
      </div>
    </section>
  );
}
