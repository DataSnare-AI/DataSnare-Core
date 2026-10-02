import assert from 'node:assert/strict';
import test from 'node:test';
import { loadNamedTenants, namedTenants, workspaceRoute } from './workspaceContext.js';

test('named tenants deduplicate numeric IDs and never expose unnamed IDs', () => {
  assert.deepEqual(namedTenants({
    memberships: [{ tenant_id: '01', tenant_name: 'Alpha' }, { tenant_id: 2 }, { tenant_id: -1, tenant_name: 'Invalid' }],
    tenant_subscriptions: [{ tenant_id: 1, tenant_name: 'Alpha' }, { tenant_id: 3, tenant_name: 'Beta' }],
  }), [{ id: '1', name: 'Alpha' }, { id: '3', name: 'Beta' }]);
});

test('admin directory is ignored for non-admin profiles', () => {
  const directory = [{ tenant_id: 9, tenant_name: 'Admin tenant' }];
  assert.deepEqual(namedTenants({ role: 'viewer' }, directory), []);
  assert.deepEqual(namedTenants({ role: 'platform_admin' }, directory), [{ id: '9', name: 'Admin tenant' }]);
});

test('regular users load only the bearer-authenticated Core profile', async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({ role: 'operator', memberships: [{ tenant_id: 4, tenant_name: 'Four' }] }) };
  };
  assert.deepEqual(await loadNamedTenants({ token: 'test-token', fetcher }), [{ id: '4', name: 'Four' }]);
  assert.deepEqual(calls, [{ url: '/api/auth/profile', options: { headers: { Authorization: 'Bearer test-token' } } }]);
});

test('profile props avoid a fetch until refresh and admins may load the directory', async () => {
  const calls = [];
  const profile = { role: 'viewer', tenant_subscriptions: [{ tenant_id: 1, tenant_name: 'One' }] };
  const fetcher = async (url, options) => {
    calls.push(url);
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    return { ok: true, json: async () => url === '/api/auth/profile' ? { role: 'platform_admin' } : { tenants: [{ tenant_id: 2, tenant_name: 'Two' }] } };
  };
  assert.deepEqual(await loadNamedTenants({ profile, token: 'test-token', fetcher }), [{ id: '1', name: 'One' }]);
  assert.deepEqual(calls, []);
  assert.deepEqual(await loadNamedTenants({ profile, token: 'test-token', refresh: true, fetcher }), [{ id: '2', name: 'Two' }]);
  assert.deepEqual(calls, ['/api/auth/profile', '/api/admin/tenants']);
});

test('missing sessions do not fetch and profile failures do not invent a tenant', async () => {
  assert.deepEqual(await loadNamedTenants({ token: '', fetcher: () => assert.fail('Unexpected request') }), []);
  await assert.rejects(loadNamedTenants({ token: 'test-token', fetcher: async () => ({ ok: false, status: 403 }) }), /memberships \(403\)/);
  assert.deepEqual(namedTenants({ memberships: [null, { tenant_id: 42, tenant_name: ' ' }] }), []);
});

test('console path and legacy hash resolve separately from Core home and standalone tools', () => {
  assert.equal(workspaceRoute('/aianalysis', '#knowledge'), 'aianalysis');
  assert.equal(workspaceRoute('/aianalysis/', ''), 'aianalysis');
  assert.equal(workspaceRoute('/', '#tool-aianalysis'), 'aianalysis');
  assert.equal(workspaceRoute('/', '#tool-aiperf'), 'aiperf');
  assert.equal(workspaceRoute('/', '#knowledge'), 'home');
});