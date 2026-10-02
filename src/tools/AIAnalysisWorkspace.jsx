import { useEffect, useMemo, useState } from 'react';
import { BarChart3, CircleHelp, Cpu, FileText, FolderOpen, Network, Save, Search, Workflow } from 'lucide-react';
import { buildRequestHeaders, readLaunchContext } from '../contracts/session';
import AINetScopeWorkbench from './AINetScopeWorkbench';
import AILogScopeWorkbench from './AILogScopeWorkbench';
import EvidenceTimeline from './EvidenceTimeline';
import NativeToolWorkbench from './NativeToolWorkbench';

const modules = [
  { id: 'investigation', label: 'Investigation', icon: Workflow, status: 'Integrating' },
  { id: 'ailogscope', label: 'Logs', icon: FileText, status: 'Available' },
  { id: 'aiperf', label: 'Performance', icon: BarChart3, status: 'Available' },
  { id: 'aiprocmon', label: 'Processes', icon: Cpu, status: 'Available' },
  { id: 'ainetscope', label: 'Network', icon: Network, status: 'Available' },
  { id: 'airca', label: 'AIRootCause', icon: Workflow, status: 'Integrating' },
  { id: 'aimemorydump', label: 'Memory dump', icon: CircleHelp, status: 'Planned' },
];

function InvestigationOverview({
  onSelect, tenantId, onTenantChange, evidence, loading, error, onRefresh,
  selectedEvidenceIds, onToggleEvidence, timeline, severityFilter, onSeverityChange,
  cases, activeCaseId, onSaveCase, onLoadCase, caseTitle, onCaseTitleChange,
  caseDescription, onCaseDescriptionChange, savingCase, caseMessage,
}) {
  return <div className="analysis-workspace__overview">
    <div className="analysis-workspace__overview-heading">
      <div><p className="eyebrow">Investigation workspace</p><h3>Bring evidence into one analysis</h3></div>
      <span className="analysis-workspace__status"><Workflow size={15} /> Integration in progress</span>
    </div>
    <p className="analysis-workspace__lede">Run an analyzer, preserve its source artifact, and combine timestamped event previews from multiple plugins. Shared cases and root-cause correlation are still being integrated.</p>
    <div className="analysis-workspace__evidence-toolbar"><label>Tenant ID<input value={tenantId} onChange={(event) => onTenantChange(event.target.value)} inputMode="numeric" placeholder="Tenant ID" /></label><button className="admin-secondary-button" type="button" onClick={onRefresh} disabled={loading || !tenantId.trim()}>{loading ? 'Refreshing…' : 'Refresh evidence'}</button></div>
    {error && <p className="tool-workbench__error" role="alert">{error}</p>}
    <div className="analysis-workspace__evidence"><div className="analysis-workspace__evidence-heading"><h4>Recent evidence</h4><span>{evidence.length} items</span></div>{loading && !evidence.length ? <p className="analysis-workspace__empty">Loading tenant evidence…</p> : evidence.length ? <div className="analysis-workspace__evidence-list">{evidence.map((item) => <article key={item.job_id}><label className="analysis-workspace__evidence-select"><input type="checkbox" checked={selectedEvidenceIds.includes(item.job_id)} onChange={() => onToggleEvidence(item.job_id)} aria-label={`Include ${item.artifact_name} in timeline`} /></label><div><strong>{item.artifact_name}</strong><small>{item.plugin_id} · {item.source_schema || 'schema pending'}</small></div><span>{item.event_count} events · {item.finding_count} findings</span><time>{item.created_at ? new Date(item.created_at).toLocaleString() : item.state}</time></article>)}</div> : <p className="analysis-workspace__empty">No completed plugin evidence is available for this tenant yet.</p>}</div>
    {!selectedEvidenceIds.length ? <p className="analysis-workspace__empty">Select evidence above to build a merged timeline.</p> : <EvidenceTimeline events={timeline} severityFilter={severityFilter} onSeverityChange={onSeverityChange} />}
    <section className="analysis-workspace__cases" aria-label="Saved investigations">
      <form className="analysis-workspace__save-case" onSubmit={onSaveCase}>
        <label>Investigation title<input value={caseTitle} onChange={(event) => onCaseTitleChange(event.target.value)} placeholder="Database outage review" maxLength={200} required /></label>
        <label>Working note<input value={caseDescription} onChange={(event) => onCaseDescriptionChange(event.target.value)} placeholder="Optional summary" maxLength={4000} /></label>
        <button className="primary-button" type="submit" disabled={savingCase || !selectedEvidenceIds.length || !caseTitle.trim()}><Save size={15} /> {savingCase ? 'Saving…' : 'Save investigation'}</button>
      </form>
      <div className="analysis-workspace__load-case"><label><FolderOpen size={15} /> Reopen saved investigation<select value={activeCaseId} onChange={(event) => onLoadCase(event.target.value)}><option value="">Choose a saved case</option>{cases.map((item) => <option key={item.investigation_id} value={item.investigation_id}>{item.title} · {item.evidence_count} evidence items</option>)}</select></label></div>
      {caseMessage && <p className="analysis-workspace__case-message" role="status">{caseMessage}</p>}
    </section>
    <div className="analysis-workspace__module-list">
      {modules.filter((module) => module.status === 'Available').map((module) => {
        const Icon = module.icon;
        return <button key={module.id} type="button" onClick={() => onSelect(module.id)}><Icon size={17} /><span>{module.label}</span><small>Open module</small></button>;
      })}
    </div>
    <p className="analysis-workspace__boundary"><Search size={15} /> Saved cases retain bounded normalized previews and provenance; source artifacts remain in tenant artifact storage.</p>
  </div>;
}

export default function AIAnalysisWorkspace() {
  const context = readLaunchContext();
  const [activeModule, setActiveModule] = useState('investigation');
  const [tenantId, setTenantId] = useState(() => context?.account?.tenantId || localStorage.getItem('datasnare:tenant-id') || '');
  const [evidence, setEvidence] = useState([]);
  const [selectedEvidenceIds, setSelectedEvidenceIds] = useState([]);
  const [severityFilter, setSeverityFilter] = useState('all');
  const [loadingEvidence, setLoadingEvidence] = useState(false);
  const [evidenceError, setEvidenceError] = useState('');
  const [cases, setCases] = useState([]);
  const [activeCaseId, setActiveCaseId] = useState('');
  const [caseTitle, setCaseTitle] = useState('');
  const [caseDescription, setCaseDescription] = useState('');
  const [savingCase, setSavingCase] = useState(false);
  const [caseMessage, setCaseMessage] = useState('');
  const selected = modules.find((module) => module.id === activeModule) || modules[0];
  const timeline = useMemo(() => evidence
    .filter((item) => selectedEvidenceIds.includes(item.job_id))
    .flatMap((item) => (item.event_preview || []).map((event) => ({
      ...event,
      jobId: item.job_id,
      pluginId: item.plugin_id,
      artifactName: item.artifact_name,
    })))
    .sort((left, right) => {
      if (!left.timestamp) return right.timestamp ? 1 : 0;
      if (!right.timestamp) return -1;
      return Date.parse(left.timestamp) - Date.parse(right.timestamp);
    }), [evidence, selectedEvidenceIds]);

  const loadEvidence = async () => {
    if (!tenantId.trim()) {
      setEvidence([]);
      setCases([]);
      setEvidenceError('Enter a tenant ID to load its evidence.');
      return;
    }
    setLoadingEvidence(true);
    setEvidenceError('');
    try {
      const headers = await buildRequestHeaders(context);
      const base = `/api/tenants/${encodeURIComponent(tenantId.trim())}/analysis`;
      const [response, casesResponse] = await Promise.all([
        fetch(`${base}/evidence?limit=30`, { headers }),
        fetch(`${base}/investigations?limit=20`, { headers }),
      ]);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || `Evidence request returned ${response.status}.`);
      setEvidence(payload.items || []);
      setSelectedEvidenceIds((current) => current.filter((jobId) => (payload.items || []).some((item) => item.job_id === jobId)));
      if (casesResponse.ok) {
        const casePayload = await casesResponse.json();
        setCases(casePayload.investigations || []);
      } else {
        const casePayload = await casesResponse.json();
        throw new Error(casePayload.detail || `Investigation list returned ${casesResponse.status}.`);
      }
      setCaseMessage('');
    } catch (error) {
      setEvidenceError(error.message || 'Could not load tenant evidence.');
    } finally {
      setLoadingEvidence(false);
    }
  };

  useEffect(() => {
    if (activeModule === 'investigation' && tenantId.trim()) loadEvidence();
  }, [activeModule]);

  const updateTenant = (value) => {
    setTenantId(value);
    setEvidence([]);
    setSelectedEvidenceIds([]);
    setCases([]);
    setActiveCaseId('');
    setCaseMessage('');
    localStorage.setItem('datasnare:tenant-id', value);
  };

  const toggleEvidence = (jobId) => {
    setSelectedEvidenceIds((current) => current.includes(jobId)
      ? current.filter((selectedId) => selectedId !== jobId)
      : [...current, jobId]);
  };

  const saveCase = async (event) => {
    event.preventDefault();
    if (!tenantId.trim() || !caseTitle.trim() || !selectedEvidenceIds.length) return;
    setSavingCase(true);
    setCaseMessage('');
    try {
      const headers = await buildRequestHeaders(context, { 'Content-Type': 'application/json' });
      const response = await fetch(`/api/tenants/${encodeURIComponent(tenantId.trim())}/analysis/investigations`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ title: caseTitle, description: caseDescription, evidence_job_ids: selectedEvidenceIds }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || `Save investigation returned ${response.status}.`);
      setCases((current) => [{ ...payload, evidence_count: payload.evidence.length }, ...current.filter((item) => item.investigation_id !== payload.investigation_id)]);
      setActiveCaseId(payload.investigation_id);
      setCaseMessage(`Saved “${payload.title}” with ${payload.evidence.length} evidence items.`);
    } catch (error) {
      setCaseMessage(error.message || 'Could not save investigation.');
    } finally {
      setSavingCase(false);
    }
  };

  const loadCase = async (investigationId) => {
    setActiveCaseId(investigationId);
    setCaseMessage('');
    if (!investigationId) return;
    try {
      const headers = await buildRequestHeaders(context);
      const response = await fetch(`/api/tenants/${encodeURIComponent(tenantId.trim())}/analysis/investigations/${encodeURIComponent(investigationId)}`, { headers });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || `Load investigation returned ${response.status}.`);
      const snapshots = (payload.evidence || []).map((item) => ({
        ...item,
        state: 'completed',
        severity_counts: {},
        event_preview: item.events || [],
      }));
      setEvidence(snapshots);
      setSelectedEvidenceIds(snapshots.map((item) => item.job_id));
      setCaseTitle(payload.title);
      setCaseDescription(payload.description || '');
      setCaseMessage(`Opened “${payload.title}”.`);
    } catch (error) {
      setCaseMessage(error.message || 'Could not reopen investigation.');
    }
  };

  return <section className="analysis-workspace" aria-labelledby="aianalysis-workspace-title">
    <header className="analysis-workspace__header">
      <div><p className="eyebrow">DataSnare-AIAnalysis · Plugin workspace</p><h2 id="aianalysis-workspace-title">Unified analysis</h2></div>
      <p>Run the available evidence analyzers from one tenant-aware workspace.</p>
    </header>
    <div className="analysis-workspace__tabs" role="tablist" aria-label="AIAnalysis modules">
      {modules.map((module) => {
        const Icon = module.icon;
        const disabled = module.status === 'Planned';
        return <button key={module.id} id={`aianalysis-tab-${module.id}`} type="button" role="tab" aria-selected={activeModule === module.id} aria-controls={`aianalysis-panel-${module.id}`} disabled={disabled} onClick={() => setActiveModule(module.id)}>
          <Icon size={15} /><span>{module.label}</span><small>{module.status}</small>
        </button>;
      })}
    </div>
    <div className="analysis-workspace__panel" role="tabpanel" id={`aianalysis-panel-${selected.id}`} aria-labelledby={`aianalysis-tab-${selected.id}`}>
      {activeModule === 'investigation' && <InvestigationOverview onSelect={setActiveModule} tenantId={tenantId} onTenantChange={updateTenant} evidence={evidence} loading={loadingEvidence} error={evidenceError} onRefresh={loadEvidence} selectedEvidenceIds={selectedEvidenceIds} onToggleEvidence={toggleEvidence} timeline={timeline} severityFilter={severityFilter} onSeverityChange={setSeverityFilter} cases={cases} activeCaseId={activeCaseId} onSaveCase={saveCase} onLoadCase={loadCase} caseTitle={caseTitle} onCaseTitleChange={setCaseTitle} caseDescription={caseDescription} onCaseDescriptionChange={setCaseDescription} savingCase={savingCase} caseMessage={caseMessage} />}
      {activeModule === 'airca' && <div className="analysis-workspace__overview"><p className="eyebrow">AIRootCause plugin</p><h3>Investigation adapter in progress</h3><p className="analysis-workspace__lede">AIRootCause currently runs as a local-first browser workspace. Its existing investigation export is registered in the plugin catalog; connecting it to tenant evidence, shared cases, and the AIAnalysis timeline is the next integration step.</p><p className="analysis-workspace__boundary"><Workflow size={15} /> No AIRootCause execution or data import is implied by this tab yet.</p></div>}
      {activeModule === 'ailogscope' && <AILogScopeWorkbench />}
      {activeModule === 'aiperf' && <NativeToolWorkbench toolId="aiperf" />}
      {activeModule === 'aiprocmon' && <NativeToolWorkbench toolId="aiprocmon" />}
      {activeModule === 'ainetscope' && <AINetScopeWorkbench />}
    </div>
  </section>;
}