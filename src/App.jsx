import { useEffect, useState } from 'react';
import { ArrowUpRight, Check, ChevronRight, CircleUserRound, ExternalLink, KeyRound, Menu, Palette, RefreshCw, Search, Server, ShieldCheck, X } from 'lucide-react';
import { ninjaOnePartner } from './contracts/partnerIntegrations';
import { buildProjectLaunchContext, projects } from './contracts/projects';
import { DEFAULT_SUITE_SKIN, normalizeSuiteSkin, SUITE_SKINS, SUITE_SKIN_STORAGE_KEY } from './contracts/skins';
import AINetScopeWorkbench from './tools/AINetScopeWorkbench';
import AILogScopeWorkbench from './tools/AILogScopeWorkbench';
import NativeToolWorkbench from './tools/NativeToolWorkbench';
import AdminConsole from './admin/AdminConsole';

const partnerIntegrations = [
  {
    ...ninjaOnePartner,
    category: 'Partner integration',
    description: 'Connect organizations, devices, alerts, activities, health reports, patch status, and ticketing from NinjaOne.',
    docsUrl: ninjaOnePartner.documentationUrl,
  },
];

function ProjectCard({ project, onOpen, onDetails }) {
  return (
    <article className={`project-card project-card--${project.accent}`}>
      <div className="project-card__topline">
        <span className="project-card__mark">{project.name.replace('DataSnare-', '').slice(0, 2)}</span>
        <span className="license-pill"><Check size={13} /> {project.license}</span>
      </div>
      <p className="eyebrow">{project.category}</p>
      <h3>{project.name}</h3>
      <p className="project-card__description">{project.description}</p>
      <div className="project-card__actions"><button className="project-card__link" type="button" onClick={() => onOpen(project)}>Open project <ArrowUpRight size={16} /></button>{project.details && <a className="project-card__details" href={`#details-${project.id}`} onClick={() => onDetails(project)}>Details</a>}</div>
    </article>
  );
}

function ProjectDetails({ project, onBack }) {
  const details = project.details;
  if (!details) return null;
  return <section className="project-details" id={`details-${project.id}`}><button className="project-details__back" type="button" onClick={onBack}>Back to projects</button><div className="project-details__heading"><p className="eyebrow">{project.category}</p><h2>{project.name}</h2><p>{details.tagline}</p></div><div className="project-details__grid"><article><p className="eyebrow">Inputs</p><ul>{details.inputs.map(input => <li key={input}>{input}</li>)}</ul></article><article><p className="eyebrow">What it does</p><ul>{details.highlights.map(highlight => <li key={highlight}>{highlight}</li>)}</ul></article></div><div className="project-details__workflow"><p className="eyebrow">Typical workflow</p><p>{details.workflow}</p><p className="project-details__caveat"><strong>Current boundary:</strong> {details.caveat}</p><span className="project-details__schema">{project.exportSchema}</span></div></section>;
}

function SuiteStatus() {
  const [tenantId, setTenantId] = useState(() => localStorage.getItem('datasnare:tenant-id') || '');
  const [status, setStatus] = useState(null);
  const [migrations, setMigrations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  const refresh = async () => {
    setLoading(true); setOffline(false);
    try {
      const [readinessResponse, migrationResponse] = await Promise.all([fetch('/api/health/readiness'), fetch('/api/projects/web-migrations')]);
      if (!readinessResponse.ok || !migrationResponse.ok) throw new Error('Core status unavailable');
      setStatus(await readinessResponse.json()); setMigrations((await migrationResponse.json()).projects || []);
    } catch (_) { setOffline(true); setStatus(null); setMigrations([]); }
    finally { setLoading(false); }
  };

  useEffect(() => { refresh(); }, []);

  const saveTenant = (event) => { const value = event.target.value; setTenantId(value); localStorage.setItem('datasnare:tenant-id', value); };
  return <section className="suite-status" id="status">
    <div className="section-heading"><div><p className="eyebrow">Control plane status</p><h2>Know what is ready.</h2></div><p>Keep tenant context close while Core, the Python services, and the Azure deployment move toward the same operating surface.</p></div>
    <div className="suite-status__grid"><article className="status-panel status-panel--context"><div className="status-panel__heading"><span><Server size={17} /> Workspace context</span><button className="icon-button" type="button" onClick={refresh} aria-label="Refresh Core status"><RefreshCw size={15} /></button></div><label>Active test tenant<input value={tenantId} onChange={saveTenant} placeholder="Tenant ID" inputMode="numeric" /></label><small>Stored locally until shared authentication is connected.</small></article><article className="status-panel"><div className="status-panel__heading"><span><ShieldCheck size={17} /> Core readiness</span><span className={`status-indicator ${status?.status === 'ready' ? 'status-indicator--good' : ''}`}>{loading ? 'Checking' : status?.status || (offline ? 'Offline' : 'Unknown')}</span></div>{status ? <div className="readiness-list">{Object.entries(status.checks).map(([key, value]) => <span key={key}><i className={value ? 'check-dot check-dot--good' : 'check-dot'} />{key.replaceAll('_', ' ')}</span>)}</div> : <p className="status-panel__message">{offline ? 'Core API is not connected yet. The local shell remains available.' : 'Checking local services...'}</p>}</article></div>
    <div className="migration-strip"><div className="status-panel__heading"><span>Web migration contracts</span><span>{migrations.length || 4} tools</span></div><div className="migration-list">{(migrations.length ? migrations : [{ project_id: 'ainetscope', status: 'contract-ready' }, { project_id: 'ailogscope', status: 'contract-ready' }, { project_id: 'aiperf', status: 'contract-ready' }, { project_id: 'aiprocmon', status: 'contract-ready' }]).map((migration) => <span key={migration.project_id}><b>{migration.project_id}</b><small>{migration.status}</small></span>)}</div></div>
  </section>;
}

function KnowledgeSearch() {
  const [tenantId, setTenantId] = useState('');
  const [query, setQuery] = useState('');
  const [response, setResponse] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const search = async (event) => {
    event.preventDefault();
    if (!tenantId.trim() || !query.trim()) return;
    setLoading(true); setError('');
    try {
      const headers = new Headers({ 'Content-Type': 'application/json' });
      const token = localStorage.getItem('datasnare:auth-token');
      if (token) headers.set('Authorization', `Bearer ${token}`);
      else {
        const readinessResponse = await fetch('/api/health/readiness');
        const readiness = readinessResponse.ok ? await readinessResponse.json() : null;
        if (readiness?.environment !== 'development') throw new Error('Sign in through Core before searching tenant knowledge.');
        headers.set('X-Actor', 'core-staging-ui');
        headers.set('X-Role', 'viewer');
      }
      const result = await fetch(`/api/tenants/${encodeURIComponent(tenantId.trim())}/rag/retrieve`, { method: 'POST', headers, body: JSON.stringify({ query: query.trim(), top_k: 8 }) });
      if (!result.ok) throw new Error(`Knowledge search returned ${result.status}.`);
      setResponse(await result.json());
    } catch (searchError) { setResponse(null); setError(searchError.message || 'Knowledge search failed.'); }
    finally { setLoading(false); }
  };

  return <section className="knowledge-search" id="knowledge">
    <div className="section-heading"><div><p className="eyebrow">Tenant knowledge fabric</p><h2>Ask across your evidence.</h2></div><p>Search agent notes, runbooks, alerts, changes, and indexed documents with citations back to their source.</p></div>
    <form className="knowledge-search__form" onSubmit={search}><label><span>Tenant</span><input value={tenantId} onChange={(event) => setTenantId(event.target.value)} placeholder="Tenant ID" inputMode="numeric" /></label><label className="knowledge-search__query"><span>Question</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="What changed around the database service?" /></label><button className="primary-button" type="submit" disabled={loading || !tenantId.trim() || !query.trim()}><Search size={16} /> {loading ? 'Searching' : 'Search knowledge'}</button></form>
    {error && <p className="knowledge-search__error">{error}</p>}
    {response && <div className="knowledge-search__results"><div className="knowledge-search__status"><strong>{response.results.length.toLocaleString()} results</strong><span>{response.status} · {response.retrieval_id}</span></div>{response.results.map((result) => <article className="knowledge-result" key={`${result.item_id}-${result.metadata?.chunk_index || 0}`}><div><p className="eyebrow">{result.provenance.source_type}</p><h3>{result.title || result.provenance.source_name || result.item_id}</h3><p>{result.text}</p></div><small>{result.provenance.site_id || 'Tenant evidence'} · {result.provenance.source_id}</small></article>)}{response.citations.length > 0 && <p className="knowledge-search__citations">{response.citations.length} source citations attached</p>}</div>}
  </section>;
}

export default function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [detailsProject, setDetailsProject] = useState(null);
  const [locationHash, setLocationHash] = useState(() => window.location.hash);
  const [skin, setSkin] = useState(() => normalizeSuiteSkin(localStorage.getItem(SUITE_SKIN_STORAGE_KEY) || DEFAULT_SUITE_SKIN));
  const [authToken, setAuthToken] = useState(() => localStorage.getItem('datasnare:auth-token') || '');
  const [accountProfile, setAccountProfile] = useState(null);
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const isAdminPage = locationHash.startsWith('#admin') && accountProfile?.role === 'platform_admin' && Boolean(authToken);

  useEffect(() => {
    const updateLocation = () => setLocationHash(window.location.hash);
    window.addEventListener('hashchange', updateLocation);
    return () => window.removeEventListener('hashchange', updateLocation);
  }, []);

  const loadAccountProfile = async (token) => {
    const response = await fetch('/api/auth/profile', { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) {
      let detail = `Could not verify the shared identity session (${response.status}).`;
      try {
        const payload = await response.json();
        if (payload?.detail) detail = `${detail} ${payload.detail}`;
      } catch (_) {
        // Keep the HTTP status when the API response is not JSON.
      }
      throw new Error(detail);
    }
    setAccountProfile(await response.json());
  };

  useEffect(() => {
    if (!authToken) return;
    loadAccountProfile(authToken).catch(() => {
      localStorage.removeItem('datasnare:auth-token');
      setAuthToken('');
      setAccountProfile(null);
    });
  }, []);

  const signIn = async (event) => {
    event.preventDefault();
    setLoginBusy(true);
    setLoginError('');
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginUsername, password: loginPassword }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || 'Sign in failed.');
      localStorage.setItem('datasnare:auth-token', payload.token);
      localStorage.setItem('actor', payload.actor);
      localStorage.setItem('username', payload.username);
      setAuthToken(payload.token);
      await loadAccountProfile(payload.token);
      setLoginPassword('');
    } catch (error) {
      setLoginError(error.message || 'Sign in failed.');
    } finally {
      setLoginBusy(false);
    }
  };

  const signOut = async () => {
    if (authToken) {
      await fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${authToken}` } }).catch(() => {});
    }
    localStorage.removeItem('datasnare:auth-token');
    localStorage.removeItem('actor');
    localStorage.removeItem('username');
    setAuthToken('');
    setAccountProfile(null);
    setSessionOpen(false);
  };

  const selectSkin = (nextSkin) => {
    const normalized = normalizeSuiteSkin(nextSkin);
    setSkin(normalized);
    localStorage.setItem(SUITE_SKIN_STORAGE_KEY, normalized);
  };

  const openProject = (project) => {
    if (project.id === 'core') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    sessionStorage.setItem('datasnare:lastLaunchContext', JSON.stringify(buildProjectLaunchContext(project, {}, skin)));
    const workbench = document.getElementById(`tool-${project.id}`);
    if (workbench) {
      window.location.hash = `tool-${project.id}`;
      workbench.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (project.id === 'aiops') {
      window.location.assign('https://datasnare-aiops.com');
      return;
    }
    if (project.details) {
      setDetailsProject(project);
      window.location.hash = `details-${project.id}`;
      window.setTimeout(() => document.getElementById(`details-${project.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
    }
  };

  return (
    <div className={`app-shell skin-${skin}`}>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="DataSnare home">
          <span className="brand__glyph">DS</span>
          <span>DataSnare</span>
        </a>
        <button className="menu-toggle" type="button" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle navigation">
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
        <nav className={`topbar__nav ${menuOpen ? 'topbar__nav--open' : ''}`}>
          <a href="#projects" onClick={() => setMenuOpen(false)}>Projects</a>
          <a href="#knowledge" onClick={() => setMenuOpen(false)}>Knowledge</a>
          <a href="#access" onClick={() => setMenuOpen(false)}>Access</a>
          <a href="#billing" onClick={() => setMenuOpen(false)}>Licensing</a>
          {accountProfile?.role === 'platform_admin' && <a href="#admin/tenants" onClick={() => setMenuOpen(false)}>Admin</a>}
          <button className="session-button" type="button" onClick={() => setSessionOpen(true)}>
            <CircleUserRound size={17} /> {accountProfile?.display_name || accountProfile?.username || 'Sign in'}
          </button>
        </nav>
        <div className="skin-picker" aria-label="Suite skin">
          <Palette size={15} aria-hidden="true" />
          {Object.values(SUITE_SKINS).map((option) => <button className={skin === option.id ? 'skin-picker__option skin-picker__option--active' : 'skin-picker__option'} key={option.id} type="button" onClick={() => selectSkin(option.id)} aria-pressed={skin === option.id}>{option.label}</button>)}
        </div>
      </header>

      <main id="top">
        {isAdminPage ? <AdminConsole token={authToken} /> : <>
        <section className="hero">
          <div className="hero__copy">
            <p className="eyebrow">The DataSnare control plane</p>
            <h1>One workspace for the moments when systems get complicated.</h1>
            <p className="hero__lede">Launch every DataSnare investigation from one account, with each tool licensed and operated on its own terms.</p>
            <div className="hero__actions">
              <a className="primary-button" href="#projects">Explore projects <ChevronRight size={17} /></a>
              <button className="quiet-button" type="button" onClick={() => setSessionOpen(true)}><KeyRound size={17} /> Connect account</button>
            </div>
          </div>
          <div className="hero__signal" aria-label="Suite status">
            <div className="signal-orbit signal-orbit--one" />
            <div className="signal-orbit signal-orbit--two" />
            <div className="signal-core"><ShieldCheck size={32} /><span>Suite ready</span></div>
            <span className="signal-label signal-label--one">Observe</span>
            <span className="signal-label signal-label--two">Explain</span>
            <span className="signal-label signal-label--three">Act</span>
          </div>
        </section>

        {detailsProject ? <ProjectDetails project={detailsProject} onBack={() => { setDetailsProject(null); window.location.hash = 'projects'; }} /> : <><section className="section-heading" id="projects">
          <div><p className="eyebrow">Project registry</p><h2>Six tools, one point of entry.</h2></div>
          <p>Each DataSnare tool keeps its own release cycle and license while Core keeps your context close.</p>
        </section>
        <section className="project-grid" aria-label="DataSnare projects">
          {projects.map((project) => <ProjectCard key={project.id} project={project} onOpen={openProject} onDetails={setDetailsProject} />)}
        </section></>}

        <SuiteStatus />
        <KnowledgeSearch />
        <div id="tool-ainetscope"><AINetScopeWorkbench /></div>
        <div id="tool-ailogscope"><AILogScopeWorkbench /></div>
        <div id="tool-aiperf"><NativeToolWorkbench toolId="aiperf" /></div>
        <div id="tool-aiprocmon"><NativeToolWorkbench toolId="aiprocmon" /></div>

        <section className="partner-section" id="partners">
          <div className="section-heading section-heading--partner">
            <div><p className="eyebrow">Partner connections</p><h2>Bring your RMM context into the investigation.</h2></div>
            <p>Core links external service data to the DataSnare workspace without treating a partner API as a DataSnare product license.</p>
          </div>
          {partnerIntegrations.map((partner) => (
            <article className="partner-card" key={partner.name}>
              <div className="partner-card__mark"><span>N1</span></div>
              <div className="partner-card__body"><p className="eyebrow">{partner.category}</p><h3>{partner.name}</h3><p>{partner.description}</p></div>
              <a className="partner-card__link" href={partner.docsUrl} target="_blank" rel="noreferrer">View API docs <ExternalLink size={16} /></a>
            </article>
          ))}
        </section>

        <section className="access-band" id="access">
          <div><p className="eyebrow">Shared access</p><h2>Sign in once. Move with the investigation.</h2></div>
          <div className="access-band__detail"><ShieldCheck size={23} /><p>Core is the future home for the shared identity session. Project services will receive a scoped handoff instead of separate credentials.</p><button className="primary-button" type="button" onClick={() => setSessionOpen(true)}>Set up access <ChevronRight size={17} /></button></div>
        </section>

        <section className="license-section" id="billing">
          <p className="eyebrow">Product account</p><h2>Purchased products, in one place.</h2>
          {accountProfile?.tenant_subscriptions?.length ? <div className="license-list">{accountProfile.tenant_subscriptions.map((subscription) => <article className="license-row" key={`${subscription.tenant_id}-${subscription.product_key}`}><div><strong>{subscription.tenant_name}</strong><span>{subscription.product_name || subscription.product_key} · {subscription.plan_name || subscription.plan_key || subscription.plan} · {subscription.account_status}</span></div><div><strong>{subscription.price_monthly != null ? `${subscription.currency || 'USD'} ${subscription.price_monthly}/mo` : 'Custom pricing'}</strong><span>{subscription.limits?.users_allocated ?? 0} users · {subscription.limits?.systems_allocated ?? 0} systems</span></div></article>)}</div> : <p>{authToken ? 'No purchased products are assigned to this account yet.' : 'Sign in to view your organization’s current product plans. Core is the planned home for suite identity, product entitlements, and billing; AIOps continues to operate its service during the transition.'}</p>}
        </section>
        </>}
      </main>

      <footer className="footer"><span>DataSnare / app.datasnare.com</span><span>Core shell v0.1</span></footer>

      {sessionOpen && <div className="modal-backdrop" role="presentation" onClick={() => setSessionOpen(false)}><section className="session-modal" role="dialog" aria-modal="true" aria-labelledby="session-title" onClick={(event) => event.stopPropagation()}><button className="modal-close" type="button" onClick={() => setSessionOpen(false)} aria-label="Close"><X size={18} /></button><p className="eyebrow">Shared identity</p><h2 id="session-title">{accountProfile ? 'Your DataSnare account.' : 'Sign in to DataSnare.'}</h2>{accountProfile ? <><p>Signed in as {accountProfile.display_name || accountProfile.username}.</p><button className="primary-button" type="button" onClick={signOut}>Sign out <KeyRound size={17} /></button></> : <form className="session-form" onSubmit={signIn}><label>Username<input value={loginUsername} onChange={(event) => setLoginUsername(event.target.value)} autoComplete="username" required /></label><label>Password<input type="password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} autoComplete="current-password" required /></label>{loginError && <p className="session-form__error" role="alert">{loginError}</p>}<button className="primary-button" type="submit" disabled={loginBusy}>{loginBusy ? 'Signing in…' : 'Sign in'} <KeyRound size={17} /></button></form>}</section></div>}
    </div>
  );
}
