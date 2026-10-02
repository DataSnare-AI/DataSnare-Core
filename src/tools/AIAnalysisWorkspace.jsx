import { useMemo, useState } from 'react';
import { ArrowLeft, BarChart3, CircleHelp, Clock3, Cpu, FileText, FolderOpen, Network, RefreshCw, Save, Search, TriangleAlert, Workflow } from 'lucide-react';
import { buildRequestHeaders, readLaunchContext } from '../contracts/session';
import AINetScopeWorkbench from './AINetScopeWorkbench';
import AILogScopeWorkbench from './AILogScopeWorkbench';
import EvidenceTimeline from './EvidenceTimeline';
import NativeToolWorkbench from './NativeToolWorkbench';
import TenantSelect, { useTenantSelection } from './TenantSelect';
import { buildInvestigationMetadata, compareSampleWindow, epochOf, metadataError, toLocalDateTime, toOffsetISOString } from './investigationTime';

const EMPTY_METADATA = { incident_at: '', incident_description: '', window_start: '', window_end: '' };

const modules = [
  { id: 'investigation', label: 'Investigation', icon: Workflow, status: 'Integrating' },
  { id: 'ailogscope', label: 'Logs', icon: FileText, status: 'Available' },
  { id: 'aiperf', label: 'Performance', icon: BarChart3, status: 'Available' },
  { id: 'aiprocmon', label: 'Processes', icon: Cpu, status: 'Available' },
  { id: 'ainetscope', label: 'Network', icon: Network, status: 'Available' },
  { id: 'airca', label: 'AIRootCause', icon: Workflow, status: 'Integrating' },
  { id: 'aimemorydump', label: 'Memory dump', icon: CircleHelp, status: 'Planned' },
];

function EvidenceTimes({ item }) {
  const format = (value) => Number.isFinite(epochOf(value)) ? new Date(value).toLocaleString([], {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
    minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3, hour12: false,
  }) : 'Unavailable';
  return <div className="analysis-evidence-times">
    <span><b>Sample start</b><time>{format(item.start_time)}</time></span>
    <span><b>Sample end</b><time>{format(item.end_time)}</time></span>
    <span><b>Uploaded</b><time>{format(item.created_at)}</time></span>
  </div>;
}

function EvidenceWindowStatus({ item, investigationWindow }) {
  const status = compareSampleWindow(item, investigationWindow);
  if (!status.text) return null;
  const Icon = status.kind === 'before' || status.kind === 'after' ? TriangleAlert : status.kind === 'unavailable' ? CircleHelp : Clock3;
  return <span className={`analysis-evidence-window analysis-evidence-window--${status.kind}`} title={status.text}><Icon size={15} aria-hidden="true" /><span>{status.text}</span></span>;
}

function InvestigationOverview({
  onSelect, tenantId, evidence, loading, error, onRefresh,
  selectedEvidenceIds, onToggleEvidence, timeline, severityFilter, onSeverityChange,
  cases, activeCaseId, onSaveCase, onLoadCase, caseTitle, onCaseTitleChange,
  caseDescription, onCaseDescriptionChange, savingCase, caseMessage,
  metadataFields, onMetadataChange, investigationWindow, incidentAt,
}) {
  const dateError = metadataError(metadataFields);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time';
  return <div className="analysis-workspace__overview">
    <div className="analysis-workspace__overview-heading">
      <div><p className="eyebrow">Investigation workspace</p><h3>Bring evidence into one analysis</h3></div>
      <span className="analysis-workspace__status"><Workflow size={15} /> Integration in progress</span>
    </div>
    <p className="analysis-workspace__lede">Run an analyzer, preserve its source artifact, and combine timestamped event previews from multiple plugins. Shared cases and root-cause correlation are still being integrated.</p>
    <div className="analysis-workspace__evidence-toolbar"><button className="admin-secondary-button" type="button" onClick={onRefresh} disabled={loading || !tenantId}><RefreshCw size={15} /> {loading ? 'Refreshing…' : 'Refresh evidence'}</button></div>
    {error && <p className="tool-workbench__error" role="alert">{error}</p>}
    <form id="analysis-investigation-form" className="analysis-workspace__save-case analysis-workspace__metadata" onSubmit={onSaveCase}>
      <label>Investigation title<input value={caseTitle} onChange={(event) => onCaseTitleChange(event.target.value)} placeholder="Database outage review" maxLength={200} required /></label>
      <label>Working note<textarea value={caseDescription} onChange={(event) => onCaseDescriptionChange(event.target.value)} maxLength={4000} rows={2} /></label>
      <p className="analysis-workspace__metadata-timezone">Datetimes in {timezone} · millisecond precision</p>
      <label>Incident datetime<input type="datetime-local" step="0.001" value={metadataFields.incident_at} onChange={(event) => onMetadataChange('incident_at', event.target.value)} /></label>
      <label>Incident description<textarea value={metadataFields.incident_description} onChange={(event) => onMetadataChange('incident_description', event.target.value)} maxLength={4000} rows={2} /></label>
      <label>Investigation window start<input type="datetime-local" step="0.001" value={metadataFields.window_start} required={Boolean(metadataFields.window_end)} onChange={(event) => onMetadataChange('window_start', event.target.value)} /></label>
      <label>Investigation window end<input type="datetime-local" step="0.001" value={metadataFields.window_end} required={Boolean(metadataFields.window_start)} onChange={(event) => onMetadataChange('window_end', event.target.value)} /></label>
      {dateError && <p className="tool-workbench__error analysis-workspace__metadata-error" role="alert">{dateError}</p>}
    </form>
    <div className="analysis-workspace__evidence"><div className="analysis-workspace__evidence-heading"><h4>Recent evidence</h4><span>{evidence.length} items</span></div>{loading && !evidence.length ? <p className="analysis-workspace__empty">Loading tenant evidence…</p> : evidence.length ? <div className="analysis-workspace__evidence-list">{evidence.map((item) => <article key={item.job_id}><label className="analysis-workspace__evidence-select"><input type="checkbox" checked={selectedEvidenceIds.includes(item.job_id)} onChange={() => onToggleEvidence(item.job_id)} aria-label={`Include ${item.artifact_name} in timeline`} /></label><div><strong>{item.artifact_name}</strong><small>{item.plugin_id} · {item.source_schema || 'schema pending'}</small><EvidenceWindowStatus item={item} investigationWindow={investigationWindow} /></div><span>{item.event_count} events · {item.finding_count} findings</span><EvidenceTimes item={item} /></article>)}</div> : <p className="analysis-workspace__empty">No completed plugin evidence is available for this tenant yet.</p>}</div>
    {!selectedEvidenceIds.length ? <p className="analysis-workspace__empty">Select evidence above to build a merged timeline.</p> : <EvidenceTimeline events={timeline} evidenceRanges={evidence.filter((item) => selectedEvidenceIds.includes(item.job_id))} investigationWindow={investigationWindow} incidentAt={incidentAt} severityFilter={severityFilter} onSeverityChange={onSeverityChange} />}
    <section className="analysis-workspace__cases" aria-label="Saved investigations">
      <button className="primary-button analysis-workspace__save-command" type="submit" form="analysis-investigation-form" disabled={savingCase || !selectedEvidenceIds.length || !caseTitle.trim() || Boolean(dateError)}><Save size={15} /> {savingCase ? 'Saving…' : 'Save investigation'}</button>
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

export default function AIAnalysisWorkspace({ profile, token, onNavigate } = {}) {
  const selection = useTenantSelection({ profile, token });
  return <AnalysisConsole key={`${token || ''}:${selection.tenantId}`} selection={selection} onNavigate={onNavigate} />;
}

function AnalysisConsole({ selection, onNavigate }) {
  const tenantId = selection.tenantId;
  const launchContext = readLaunchContext();
  const context = { ...launchContext, account: { ...launchContext?.account, tenantId } };
  const [activeModule, setActiveModule] = useState('investigation');
  const [visitedModules, setVisitedModules] = useState(['investigation']);
  const [evidence, setEvidence] = useState([]);
  const [selectedEvidenceIds, setSelectedEvidenceIds] = useState([]);
  const [severityFilter, setSeverityFilter] = useState('all');
  const [loadingEvidence, setLoadingEvidence] = useState(false);
  const [evidenceError, setEvidenceError] = useState('');
  const [cases, setCases] = useState([]);
  const [activeCaseId, setActiveCaseId] = useState('');
  const [caseTitle, setCaseTitle] = useState('');
  const [caseDescription, setCaseDescription] = useState('');
  const [metadataFields, setMetadataFields] = useState(EMPTY_METADATA);
  const [savingCase, setSavingCase] = useState(false);
  const [caseMessage, setCaseMessage] = useState('');
  const selectModule = (id) => {
    setActiveModule(id);
    setVisitedModules((current) => current.includes(id) ? current : [...current, id]);
  };
  const investigationWindow = !metadataError(metadataFields) && metadataFields.window_start
    ? { start: toOffsetISOString(metadataFields.window_start), end: toOffsetISOString(metadataFields.window_end) } : null;
  const incidentAt = toOffsetISOString(metadataFields.incident_at);
  const updateMetadata = (field, value) => setMetadataFields((current) => ({ ...current, [field]: value }));
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
      setEvidenceError('Choose an authorized tenant to load its evidence.');
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

  const toggleEvidence = (jobId) => {
    setSelectedEvidenceIds((current) => current.includes(jobId)
      ? current.filter((selectedId) => selectedId !== jobId)
      : [...current, jobId]);
  };

  const saveCase = async (event) => {
    event.preventDefault();
    if (!tenantId.trim() || !caseTitle.trim() || !selectedEvidenceIds.length) return;
    const dateError = metadataError(metadataFields);
    if (dateError) {
      setCaseMessage(dateError);
      return;
    }
    setSavingCase(true);
    setCaseMessage('');
    try {
      const headers = await buildRequestHeaders(context, { 'Content-Type': 'application/json' });
      const response = await fetch(`/api/tenants/${encodeURIComponent(tenantId.trim())}/analysis/investigations`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ title: caseTitle, description: caseDescription, evidence_job_ids: selectedEvidenceIds, metadata: buildInvestigationMetadata(metadataFields, caseDescription) }),
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
      setCaseDescription(payload.metadata?.working_note ?? payload.description ?? '');
      setMetadataFields({
        incident_at: toLocalDateTime(payload.metadata?.incident_at),
        incident_description: payload.metadata?.incident_description || '',
        window_start: toLocalDateTime(payload.metadata?.window_start),
        window_end: toLocalDateTime(payload.metadata?.window_end),
      });
      setCaseMessage(`Opened “${payload.title}”.`);
    } catch (error) {
      setCaseMessage(error.message || 'Could not reopen investigation.');
    }
  };

  return <section className="analysis-workspace" aria-labelledby="aianalysis-workspace-title">
    <header className="analysis-workspace__header">
      <div><a className="analysis-workspace__back" href="/" onClick={(event) => onNavigate?.('/', event)}><ArrowLeft size={16} /> Back to workspace</a><h2 id="aianalysis-workspace-title">DataSnare AIAnalysis</h2></div>
      <div className="analysis-workspace__context"><TenantSelect selection={selection} /><div className="analysis-workspace__active-case"><span>{selection.tenantName || 'No active tenant'}</span><strong>{caseTitle.trim() || 'Untitled investigation'}</strong></div></div>
    </header>
    <div className="analysis-workspace__tabs" role="tablist" aria-label="AIAnalysis modules">
      {modules.map((module) => {
        const Icon = module.icon;
        const disabled = module.status === 'Planned';
        return <button key={module.id} id={`aianalysis-tab-${module.id}`} type="button" role="tab" aria-selected={activeModule === module.id} aria-controls={`aianalysis-panel-${module.id}`} disabled={disabled} onClick={() => selectModule(module.id)}>
          <Icon size={15} /><span>{module.label}</span><small>{module.status}</small>
        </button>;
      })}
    </div>
    {modules.map((module) => <div key={`${tenantId}:${module.id}`} className="analysis-workspace__panel" role="tabpanel" id={`aianalysis-panel-${module.id}`} aria-labelledby={`aianalysis-tab-${module.id}`} hidden={activeModule !== module.id}>
      {visitedModules.includes(module.id) && <>
        {module.id === 'investigation' && <InvestigationOverview onSelect={selectModule} tenantId={tenantId} evidence={evidence} loading={loadingEvidence} error={evidenceError} onRefresh={loadEvidence} selectedEvidenceIds={selectedEvidenceIds} onToggleEvidence={toggleEvidence} timeline={timeline} severityFilter={severityFilter} onSeverityChange={setSeverityFilter} cases={cases} activeCaseId={activeCaseId} onSaveCase={saveCase} onLoadCase={loadCase} caseTitle={caseTitle} onCaseTitleChange={setCaseTitle} caseDescription={caseDescription} onCaseDescriptionChange={setCaseDescription} savingCase={savingCase} caseMessage={caseMessage} metadataFields={metadataFields} onMetadataChange={updateMetadata} investigationWindow={investigationWindow} incidentAt={incidentAt} />}
        {module.id === 'airca' && <div className="analysis-workspace__overview"><p className="eyebrow">AIRootCause plugin</p><h3>Investigation adapter in progress</h3><p className="analysis-workspace__lede">AIRootCause currently runs as a local-first browser workspace. Its existing investigation export is registered in the plugin catalog; connecting it to tenant evidence, shared cases, and the AIAnalysis timeline is the next integration step.</p><p className="analysis-workspace__boundary"><Workflow size={15} /> No AIRootCause execution or data import is implied by this tab yet.</p></div>}
        {module.id === 'ailogscope' && <AILogScopeWorkbench selectedTenantId={tenantId} />}
        {module.id === 'aiperf' && <NativeToolWorkbench toolId="aiperf" selectedTenantId={tenantId} />}
        {module.id === 'aiprocmon' && <NativeToolWorkbench toolId="aiprocmon" selectedTenantId={tenantId} />}
        {module.id === 'ainetscope' && <AINetScopeWorkbench selectedTenantId={tenantId} />}
      </>}
    </div>)}
  </section>;
}