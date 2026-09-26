import { DEFAULT_SUITE_SKIN, normalizeSuiteSkin } from './skins';

export const CORE_LAUNCH_CONTEXT_KEY = 'datasnare:lastLaunchContext';
export const CORE_LAUNCH_SCHEMA = 'datasnare-core/project-launch-v1';

function cleanString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function readLaunchContext(storage = globalThis.sessionStorage) {
  try {
    const parsed = JSON.parse(storage.getItem(CORE_LAUNCH_CONTEXT_KEY) || 'null');
    if (!parsed || parsed.schema !== CORE_LAUNCH_SCHEMA) return null;
    const account = parsed.account || {};
    const project = parsed.project || {};
    return {
      schema: parsed.schema,
      issuedAt: cleanString(parsed.issuedAt),
      project: {
        id: cleanString(project.id),
        name: cleanString(project.name),
        path: cleanString(project.path),
        capabilities: Array.isArray(project.capabilities) ? project.capabilities.map(cleanString).filter(Boolean) : [],
      },
      account: {
        tenantId: cleanString(String(account.tenantId || '')),
        organizationId: cleanString(String(account.organizationId || '')),
        actorId: cleanString(account.actorId),
        license: cleanString(account.license),
      },
      skin: normalizeSuiteSkin(parsed.skin || DEFAULT_SUITE_SKIN),
    };
  } catch (_) {
    return null;
  }
}

export function buildSessionHeaders(context, headers = {}) {
  const next = new Headers(headers);
  if (context?.account?.actorId) next.set('X-Actor', context.account.actorId);
  if (context?.account?.tenantId) next.set('X-Tenant-Id', context.account.tenantId);
  return next;
}
