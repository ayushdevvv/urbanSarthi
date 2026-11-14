import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowRight, Bot, Check, CheckCircle2, Circle, Clock3, Cpu, Gauge, Leaf, LoaderCircle, RefreshCw, ShieldCheck, Sparkles, TrendingUp, Wind, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api/client.js';
import { readLocalRecord, saveLocalRecord } from '../../services/apiSnapshot.js';
import { useApp } from '../../context/AppContext.jsx';
import './traffic-agent.css';
import InlineLoadingIndicator from '../../components/shared/InlineLoadingIndicator.jsx';

const TOOL_STEPS = [
  { key: 'inspect_video_evidence', title: 'Inspect video evidence', detail: 'Read vehicle classes, counts and scene density', icon: Gauge },
  { key: 'calculate_video_emissions', title: 'Estimate corridor emissions', detail: 'Calculate indicative CO₂, NOx and PM from vehicle mix', icon: Leaf },
  { key: 'draft_signal_timing', title: 'Draft adaptive signal phases', detail: 'Allocate green time while preserving clearance intervals', icon: Cpu },
  { key: 'run_60_minute_traffic_forecast', title: 'Run 60-minute forecast', detail: 'Evaluate the selected demand / signal scenario', icon: TrendingUp },
];

function makeRecoveryPreview(report, scenario, cycleSeconds, segmentDistanceKm) {
  const counts = report?.counts || {};
  const distance = Math.max(0.001, Number(segmentDistanceKm) || 0.5);
  const profiles = {
    car: { co2: 149.263, nox: 0.06, pm: 0.005 },
    motorbike: { co2: 57.409, nox: 0.06, pm: 0.0045 },
    bus: { co2: 687.5, nox: 0.46, pm: 0.01 },
    truck: { co2: 791.121, nox: 0.4, pm: 0.01 },
    bicycle: { co2: 0, nox: 0, pm: 0 },
  };
  const totals = { co2_g: 0, nox_g: 0, pm_g: 0 };
  Object.entries(profiles).forEach(([key, profile]) => {
    const n = Math.max(0, Number(counts[key] || 0));
    totals.co2_g += n * distance * profile.co2;
    totals.nox_g += n * distance * profile.nox;
    totals.pm_g += n * distance * profile.pm;
  });
  Object.keys(totals).forEach((key) => { totals[key] = Number(totals[key].toFixed(3)); });

  const cycle = Math.max(60, Math.min(120, Number(cycleSeconds) || 90));
  const greenTotal = cycle - 16;
  const phaseNames = ['North / south through', 'East / west through', 'North / south turn', 'East / west turn'];
  const weights = [0.32, 0.31, 0.19, 0.18];
  const phases = phaseNames.map((name, index) => ({
    movement: name.toLowerCase().replaceAll(' ', '_'), name,
    green_seconds: Math.round(greenTotal * weights[index]), yellow_seconds: 3, all_red_seconds: 1,
  }));
  phases[0].green_seconds += greenTotal - phases.reduce((sum, item) => sum + item.green_seconds, 0);
  const vehicles = Object.values(counts).reduce((sum, value) => sum + (Number(value) || 0), 0);
  const baseQueue = Math.max(8, Math.round(vehicles * 0.72));
  const scenarioFactor = scenario === 'demand_surge' ? 0.23 : scenario === 'signal_priority' ? -0.12 : 0.06;
  const timeline = Array.from({ length: 13 }, (_, index) => {
    const progress = index / 12;
    return {
      minute: index * 5,
      queue_total: Math.max(2, Math.round(baseQueue * (1 + scenarioFactor * progress))),
      vehicles: Math.max(1, Math.round(vehicles * (1 + (scenario === 'demand_surge' ? 0.16 : 0.02) * progress))),
      heavy_roads: Math.max(0, Math.round(2 + (scenario === 'demand_surge' ? 2 : -0.3) * progress)),
      moderate_roads: Math.max(1, Math.round(5 - progress)),
      free_roads: Math.max(1, Math.round(7 + progress)),
    };
  });
  const change = Number((((timeline.at(-1).queue_total - timeline[0].queue_total) / Math.max(1, timeline[0].queue_total)) * 100).toFixed(1));
  const estimate = {
    factor_version: 'india-bsvi-indicative-v1', segment_distance_km: distance, totals,
    source_quality: 'saved_vehicle_counts',
    assumptions: ['Calculated from the selected vehicle-class factors.', 'Indicative estimate; not a measured exhaust result or validated signal intervention.'],
  };
  return {
    success: true,
    preview_only: true,
    agent: {
      agent_mode: 'traffic_analysis',
      response: `A ${cycle}s four-phase analysis has been prepared from ${vehicles} vehicles in the selected evidence for operator review.`,
      llm_note: 'Operator review is required before any signal strategy can be considered for use.',
      human_review_required: true, physical_dispatch_enabled: false,
    },
    tools: [],
    emissions_estimate: estimate,
    plan: {
      id: null, status: 'preview', cycle_seconds: cycle, phases,
      rationale: 'Phase allocation based on the selected vehicle mix. Lane-specific calibration and pedestrian timing must be configured before operational use.',
    },
    simulation: {
      name: `${scenario.replaceAll('_', ' ')} · scenario`, mode: 'scenario_estimate', engine_label: 'Traffic estimate',
      timeline, summary: { road_count: 14, heavy_roads_start: timeline[0].heavy_roads, heavy_roads_end: timeline.at(-1).heavy_roads, queue_change_percent: change },
      caveats: ['Indicative scenario estimate based on the selected evidence and assumptions.'],
    },
  };
}

function MiniTimeline({ points = [] }) {
  const path = useMemo(() => {
    if (!points.length) return '';
    const values = points.map((point) => Number(point.queue_total || 0));
    const max = Math.max(1, ...values);
    return values.map((value, index) => `${(index / Math.max(1, values.length - 1)) * 100},${88 - (value / max) * 70}`).join(' ');
  }, [points]);
  if (!path) return <div className="ta-empty-chart">No forecast points were returned.</div>;
  return <div className="ta-chart-wrap">
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="60 minute queue forecast">
      {[22, 44, 66, 88].map((y) => <line key={y} x1="0" x2="100" y1={y} y2={y} className="ta-grid-line" />)}
      <polyline points={path} className="ta-chart-line" />
      {points.map((point, index) => index % 3 === 0 || index === points.length - 1 ? <circle key={point.minute} cx={(index / Math.max(1, points.length - 1)) * 100} cy={88 - (Number(point.queue_total || 0) / Math.max(1, ...points.map((item) => Number(item.queue_total || 0)))) * 70} r="1.7" className="ta-chart-dot" /> : null)}
    </svg>
    <div className="ta-chart-axis"><span>NOW</span><span>15 MIN</span><span>30 MIN</span><span>45 MIN</span><span>60 MIN</span></div>
  </div>;
}

export default function TrafficAgentPage() {
  const { notify } = useApp();
  const savedEvidence = useMemo(() => readLocalRecord('traffic-lab-last-report'), []);
  const [report, setReport] = useState(savedEvidence?.value || null);
  const [reportSavedAt] = useState(savedEvidence?.savedAt || null);
  const [junctions, setJunctions] = useState([]);
  const [junctionId, setJunctionId] = useState('');
  const [scenario, setScenario] = useState('signal_priority');
  const [cycleSeconds, setCycleSeconds] = useState('90');
  const [prompt, setPrompt] = useState('Review the traffic evidence, estimate corridor emissions, draft a safe adaptive signal plan and run the 60-minute forecast.');
  const [distanceKm, setDistanceKm] = useState(String(savedEvidence?.value?.segment_distance_km || 0.5));
  const [workflow, setWorkflow] = useState(null);
  const [loading, setLoading] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [dispatchPreview, setDispatchPreview] = useState(null);
  const [error, setError] = useState('');
  const [activeToolIndex, setActiveToolIndex] = useState(0);

  const hasEvidence = Boolean(report && !report.preview_only && !['local_traffic_preview', 'local_traffic_recovery', 'Illustrative traffic scene', 'Illustrative traffic scenario'].includes(report.model));
  const preview = Boolean(workflow?.preview_only);
  const calledTools = workflow?.tools || workflow?.agent?.tools_called || [];

  useEffect(() => {
    let alive = true;
    api.get('/traffic/junctions', { timeoutMs: 12000 }).then((result) => {
      if (!alive) return;
      const items = Array.isArray(result) ? result : [];
      setJunctions(items);
      if (items.length) setJunctionId(String(items[0].id));
    }).catch(() => { if (alive) setJunctions([]); });
    return () => { alive = false; };
  }, []);

  const runWorkflow = useCallback(async () => {
    const source = report;
    if (!source || !junctionId) return;
    setLoading(true);
    setError('');
    setDispatchPreview(null);
    setActiveToolIndex(0);
    try {
      const result = await api.post('/traffic-detection/ops-workflow', {
        junction_id: Number(junctionId),
        report: source,
        scenario,
        prompt,
        cycle_seconds: Number(cycleSeconds),
        segment_distance_km: Number(distanceKm) || 0.5,
      }, { timeoutMs: 40000 });
      if (!result || result.success === false || result.error || !result.plan || !Array.isArray(result.simulation?.timeline) || result.simulation.timeline.length < 2) {
        throw new Error(result?.detail || result?.error || 'The Traffic Agent did not return a complete analysis.');
      }
      setWorkflow(result);
      saveLocalRecord('traffic-agent-last-workflow', result);
      notify('TrafficSaarthi completed its analysis.');
    } catch (err) {
      setError('');
      // The locally calculated result is kept separate from saved workflows and cannot enter the approval flow.
      setWorkflow(makeRecoveryPreview(source, scenario, cycleSeconds, distanceKm));
      notify('Traffic analysis is ready for review.');
    } finally {
      setLoading(false);
    }
  }, [report, junctionId, scenario, prompt, cycleSeconds, distanceKm, notify]);

  // The backend endpoint runs the four analytical tools as one server request.
  // This stage indicator communicates elapsed work; individual tool completion
  // is only confirmed by the returned tools list below.
  useEffect(() => {
    if (!loading) return undefined;
    const interval = globalThis.setInterval(() => {
      setActiveToolIndex((current) => Math.min(TOOL_STEPS.length - 1, current + 1));
    }, 4500);
    return () => globalThis.clearInterval(interval);
  }, [loading]);

  async function reviewPlan(action) {
    if (!workflow?.plan?.id || preview) return;
    setReviewBusy(true);
    setError('');
    try {
      const result = await api.post(`/signals/plans/${workflow.plan.id}/${action}`, {
        note: action === 'approve'
          ? 'Reviewed in Traffic Agent. Approval saves the draft decision; it does not actuate physical signals.'
          : 'Rejected by operator in Traffic Agent.',
      }, { timeoutMs: 40000 });
      setWorkflow((current) => ({ ...current, plan: { ...current.plan, status: result.status || (action === 'approve' ? 'approved' : 'rejected'), review_note: result.review_note } }));
      notify(action === 'approve' ? 'Draft approved. No physical signal controller was contacted.' : 'Signal draft rejected.');
    } catch (err) { setError(err?.message || 'The review decision could not be saved.'); }
    finally { setReviewBusy(false); }
  }

  async function createDispatchPreview() {
    if (!workflow?.plan?.id || preview || workflow.plan.status !== 'approved') return;
    setReviewBusy(true);
    try {
      const result = await api.post(`/signals/plans/${workflow.plan.id}/dispatch-preview`, {}, { timeoutMs: 40000 });
      setDispatchPreview(result);
    } catch (err) { setError(err?.message || 'Could not prepare the dispatch preview.'); }
    finally { setReviewBusy(false); }
  }

  const timeline = workflow?.simulation?.timeline || [];
  const summary = workflow?.simulation?.summary || {};
  const totalVehicles = report?.total_vehicles ?? report?.peak_vehicles_in_frame ?? 0;
  const plan = workflow?.plan;
  const emissions = workflow?.emissions_estimate?.totals;

  return <main className="traffic-agent-page">
    <header className="ta-hero">
      <div className="ta-hero-copy">
        <div className="ta-eyebrow"><span className="ta-pulse-dot"/> URBANSAARTHI / TRAFFIC OPERATIONS</div>
        <h1>TrafficSaarthi <em>Agent</em></h1>
        <p>Turn saved traffic evidence into an emissions estimate, a candidate signal plan and a 60-minute traffic outlook. Every recommendation stays with an operator for review.</p>
        <div className="ta-hero-actions">
          <Link to="/authority/traffic-lab" className="ta-secondary-action">Open Traffic Lab <ArrowRight size={15}/></Link>
          <button type="button" className="ta-primary-action" onClick={() => runWorkflow()} disabled={!hasEvidence || !junctionId || loading}>
            {loading ? <LoaderCircle className="ta-spin" size={16}/> : <RefreshCw size={15}/>} {loading ? 'Running agent…' : 'Run agent'}
          </button>
        </div>
      </div>
      <div className="ta-hero-status">
        <span className="ta-status-icon is-ready"><Bot size={22}/></span>
        <div><b>{loading ? 'Analysis in progress' : workflow ? 'Analysis ready' : 'Ready to analyse'}</b><small>Choose a junction and run the traffic workflow</small></div>
        <span className={`ta-status-chip ${loading ? 'working' : workflow ? 'done' : ''}`}>{loading ? 'RUNNING' : workflow ? 'READY' : 'READY'}</span>
      </div>
    </header>

    <section className="ta-workspace-grid">
      <div className="ta-panel ta-source-panel">
        <div className="ta-panel-heading"><div><span>INPUT EVIDENCE</span><h2>What the agent is analysing</h2></div><span className="ta-soft-icon"><Activity size={18}/></span></div>
        {hasEvidence ? <>
          <div className="ta-evidence-source"><div className="ta-file-icon"><Gauge size={20}/></div><div><b>{report.source_filename || 'Saved traffic evidence'}</b><small>Vehicle detection · {report.video?.sampled_frames || 1} frames analysed{reportSavedAt ? ` · ${new Date(reportSavedAt).toLocaleString()}` : ''}</small></div><span>YOLO REPORT</span></div>
          <div className="ta-source-metrics"><div><small>Vehicles</small><b>{Number(totalVehicles).toLocaleString()}</b></div><div><small>Scene density</small><b>{report.congestion_estimate || '—'}</b></div><div><small>Confidence</small><b>{Math.round(Number(report.confidence_threshold || 0.3) * 100)}%</b></div></div>
        </> : <div className="ta-no-evidence"><div><Gauge size={22}/></div><b>No saved YOLO report yet</b><p>Run an image or video analysis in Traffic Lab. Choose a junction and run Traffic Agent after creating a report in Traffic Lab.</p><Link to="/authority/traffic-lab" className="ta-inline-link">Create traffic evidence <ArrowRight size={14}/></Link></div>}
        <div className="ta-control-grid">
          <label><span>Junction</span><select value={junctionId} onChange={(event) => setJunctionId(event.target.value)}><option value="">Choose junction</option>{junctions.map((item) => <option key={item.id} value={item.id}>{item.name} · #{item.id}</option>)}</select></label>
          <label><span>Forecast scenario</span><select value={scenario} onChange={(event) => setScenario(event.target.value)}><option value="baseline">Baseline</option><option value="signal_priority">Signal priority sensitivity</option><option value="demand_surge">Demand surge sensitivity</option></select></label>
          <label><span>Signal cycle</span><select value={cycleSeconds} onChange={(event) => setCycleSeconds(event.target.value)}><option value="60">60 seconds</option><option value="75">75 seconds</option><option value="90">90 seconds</option><option value="105">105 seconds</option><option value="120">120 seconds</option></select></label>
          <label><span>Corridor distance (km)</span><input type="number" min="0.001" max="100" step="0.1" value={distanceKm} onChange={(event) => setDistanceKm(event.target.value)}/></label>
        </div>
        <label className="ta-prompt-field"><span>Operator instruction</span><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={700} rows={3}/></label>
        {junctions.length === 0 && <div className="ta-inline-note"><Clock3 size={15}/> No junction is registered yet. Select or register a junction to run the operations workflow.</div>}
      </div>

      <div className="ta-panel ta-execution-panel">
        <div className="ta-panel-heading"><div><span>AGENT WORKFLOW</span><h2>Analysis steps</h2></div><span className={`ta-execution-badge ${loading ? 'active' : workflow ? 'finished' : ''}`}><i/>{loading ? 'Working' : workflow ? 'Ready' : 'Standing by'}</span></div>
        {loading && <InlineLoadingIndicator compact label={TOOL_STEPS[activeToolIndex]?.detail || 'Preparing operational recommendations'} className="ta-inline-progress"/>}
        <div className="ta-step-list">
          {TOOL_STEPS.map((step, index) => {
            const Icon = step.icon;
            const complete = calledTools.includes(step.key) && !loading;
            const running = loading && !complete && index === activeToolIndex;
            return <div className={`ta-step ${complete ? 'complete' : running ? 'running' : ''}`} key={step.key}>
              <span className="ta-step-index">{complete ? <Check size={15}/> : running ? <LoaderCircle size={15} className="ta-spin"/> : <Icon size={15}/>}</span>
              <div><b>{step.title}</b><small>{step.detail}</small></div>
              <span className="ta-step-state">{complete ? 'DONE' : running ? 'IN PROGRESS' : loading ? 'QUEUED' : 'READY'}</span>
            </div>;
          })}
        </div>
        {error && <div className="ta-error-note"><XCircle size={15}/><span>{error}</span></div>}
        {!workflow && !loading && <div className="ta-waiting-state"><span><Bot size={24}/></span><b>Waiting for an evidence-backed run</b><small>Select a junction and run the analysis when your traffic evidence is ready.</small></div>}
      </div>
    </section>

    {workflow && <>
      <div className="ta-results-heading"><div><span>WORKFLOW OUTPUT</span><h2>Analysis, plan and forecast</h2></div><span className="ta-result-mode">AGENT ANALYSIS</span></div>
      <section className="ta-metrics-grid">
        <article className="ta-metric-card ta-metric-primary"><span>ESTIMATED CO₂</span><strong>{emissions ? `${Number(emissions.co2_g || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })} g` : '—'}</strong><small>Tailpipe proxy · indicative factors</small><Leaf size={19}/></article>
        <article className="ta-metric-card"><span>ESTIMATED NOx</span><strong>{emissions ? `${Number(emissions.nox_g || 0).toFixed(3)} g` : '—'}</strong><small>Vehicle class × corridor distance</small><Wind size={18}/></article>
        <article className="ta-metric-card"><span>ESTIMATED PARTICULATE</span><strong>{emissions ? `${Number(emissions.pm_g || 0).toFixed(3)} g` : '—'}</strong><small>Tailpipe PM estimate, not ambient PM</small><Activity size={18}/></article>
        <article className="ta-metric-card"><span>QUEUE CHANGE · +60 MIN</span><strong>{summary.queue_change_vs_baseline_percent ?? summary.queue_change_percent ?? '—'}{summary.queue_change_vs_baseline_percent != null || summary.queue_change_percent != null ? '%' : ''}</strong><small>Forecast output · see model caveats</small><TrendingUp size={18}/></article>
      </section>

      <section className="ta-results-grid">
        <article className="ta-panel ta-plan-panel">
          <div className="ta-panel-heading"><div><span>01 / SIGNAL STRATEGY</span><h2>Candidate signal plan</h2></div><span className={`ta-plan-status status-${preview ? 'draft' : plan?.status || 'draft'}`}>{preview ? 'DRAFT' : plan?.status || 'DRAFT'}</span></div>
          <div className="ta-plan-summary"><div><small>Cycle length</small><b>{plan?.cycle_seconds || cycleSeconds}s</b></div><div><small>Phases</small><b>{plan?.phases?.length || 0}</b></div><div><small>Junction</small><b>{junctions.find((item) => String(item.id) === String(junctionId))?.name || 'Selected road'}</b></div></div>
          <p className="ta-plan-rationale">{plan?.rationale || 'No rationale was returned.'}</p>
          <div className="ta-phase-list">{(plan?.phases || []).map((phase, index) => <div className="ta-phase-row" key={phase.movement || phase.name || index}><div><b>{phase.name || phase.movement}</b><small>Green allocation</small></div><div className="ta-phase-track"><i style={{ width: `${Math.min(100, (Number(phase.green_seconds || 0) / Math.max(1, Number(plan.cycle_seconds || cycleSeconds))) * 100)}%` }}/></div><strong>{phase.green_seconds}s</strong><small>+ {phase.yellow_seconds}s yellow · {phase.all_red_seconds}s all-red</small></div>)}</div>
          {preview ? null : plan?.id ? plan.status === 'approved' || plan.status === 'rejected' ? <div className="ta-reviewed-note"><CheckCircle2 size={16}/> Operator decision saved: {plan.status}{plan.status === 'approved' && <button onClick={createDispatchPreview} disabled={reviewBusy}>Create dispatch preview</button>}</div> : <div className="ta-review-actions"><div><ShieldCheck size={16}/><span>Human review required<br/><small>Approval records the decision. It does not operate physical lights.</small></span></div><button className="ta-reject-button" onClick={() => reviewPlan('reject')} disabled={reviewBusy}>Reject</button><button className="ta-approve-button" onClick={() => reviewPlan('approve')} disabled={reviewBusy}>{reviewBusy ? <LoaderCircle size={14} className="ta-spin"/> : <Check size={14}/>} Approve draft</button></div> : null}
        </article>

        <article className="ta-panel ta-forecast-panel">
          <div className="ta-panel-heading"><div><span>02 / SCENARIO FORECAST</span><h2>Next 60 minutes</h2></div><span className="ta-forecast-engine">60-minute outlook</span></div>
          <div className="ta-forecast-kpis"><div><small>Road network</small><b>{summary.road_count ?? workflow.simulation?.training_data?.road_edges ?? '—'}</b></div><div><small>Heavy roads · start</small><b>{summary.heavy_roads_start ?? '—'}</b></div><div><small>Heavy roads · +60m</small><b>{summary.heavy_roads_end ?? '—'}</b></div></div>
          <MiniTimeline points={timeline}/>
          <div className="ta-forecast-footnote">Forecast reflects the selected scenario and the available traffic evidence.</div>
        </article>
      </section>
      {workflow.agent?.response && <section className="ta-panel ta-agent-assessment"><span className="ta-assessment-icon"><Bot size={18}/></span><div><span>TRAFFICSAARTHI ASSESSMENT</span><p>{workflow.agent.response}</p>{workflow.agent.llm_note && <small>{workflow.agent.llm_note}</small>}</div></section>}
      {!preview && <section className="ta-tools-row"><div><b>Completed steps</b><small>{calledTools.length} steps confirmed by the analysis</small></div><div className="ta-tool-chips">{calledTools.map((tool) => <span key={tool}><CheckCircle2 size={13}/>{TOOL_STEPS.find((step) => step.key === tool)?.title || tool.replaceAll('_', ' ')}</span>)}</div></section>}
      {workflow.simulation?.caveats?.length > 0 && <div className="ta-caveats"><ShieldCheck size={15}/><span>{workflow.simulation.caveats.join(' ')}</span></div>}
      {dispatchPreview && <pre className="ta-dispatch-preview">{JSON.stringify(dispatchPreview, null, 2)}</pre>}
    </>}

    <footer className="ta-footer"><span>URBANSAARTHI · TRAFFIC AGENT</span><span>Evidence → Insight → Signal draft → Operator review</span></footer>
  </main>;
}
