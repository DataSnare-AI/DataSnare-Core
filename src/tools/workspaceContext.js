export function namedTenants(profile, adminTenants = []) {
  const tenants = new Map();
  const rows = [
    ...(Array.isArray(profile?.memberships) ? profile.memberships : []),
    ...(Array.isArray(profile?.tenant_subscriptions) ? profile.tenant_subscriptions : []),
    ...(profile?.role === 'platform_admin' ? adminTenants : []),
  ];
  for (const row of rows) {
    const id = Number(row?.tenant_id);
    const name = typeof row?.tenant_name === 'string' ? row.tenant_name.trim() : '';
    if (Number.isSafeInteger(id) && id > 0 && name) tenants.set(String(id), { id: String(id), name });
  }
  return [...tenants.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export async function loadNamedTenants({ profile, token, refresh = false, fetcher = globalThis.fetch }) {
  if (!token) return [];
  const headers = { Authorization: `Bearer ${token}` };
  let currentProfile = profile;
  if (!currentProfile || refresh) {
    const response = await fetcher('/api/auth/profile', { headers });
    if (!response.ok) throw new Error(`Could not load tenant memberships (${response.status}).`);
    currentProfile = await response.json();
  }
  let adminTenants = [];
  if (currentProfile?.role === 'platform_admin') {
    const response = await fetcher('/api/admin/tenants', { headers });
    if (!response.ok) throw new Error(`Could not load the tenant directory (${response.status}).`);
    adminTenants = (await response.json()).tenants || [];
  }
  return namedTenants(currentProfile, adminTenants);
}

export function workspaceRoute(pathname, hash) {
  if (pathname.replace(/\/$/, '') === '/aianalysis' || hash === '#tool-aianalysis') return 'aianalysis';
  const toolId = hash.replace(/^#tool-/, '');
  return ['ailogscope', 'ainetscope', 'aiperf', 'aiprocmon'].includes(toolId) ? toolId : 'home';
}