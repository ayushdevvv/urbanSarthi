import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, LoaderCircle, Play, Plus, RefreshCw, SlidersHorizontal, Zap } from 'lucide-react';
import PageIntro from '../../components/shared/PageIntro.jsx';
import { EmptyState } from '../../components/shared/Toast.jsx';
import useApiResource from '../../hooks/useApiResource.js';
import { api, endpoints } from '../../services/api/client.js';
import { useApp } from '../../context/AppContext.jsx';

const seconds = (n) => Number.isFinite(n) ? `${n}s` : '—';
export default function SignalPlansPage() {
  const { notify } = useApp();
  const navigate = useNavigate();
  const { data: plans, reload, fallbackReady } = useApiResource(() => api.get(endpoints.signalPlans), []);
  const { data: junctions } = useApiResource(() => api.get(endpoints.junctions), []);
  const [selectedId, setSelectedId] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [junctionId, setJunctionId] = useState('');
  const [name, setName] = useState('Operator submitted timing scenario');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState('');
  const referencePlans = [
    { id: 'scenario-plan-1', junction_id: 12, plan_type: 'adaptive_peak', status: 'reference', cycle_seconds: 90, rationale: 'Scenario timing balances the heavier north south flow.', phases: [{ name: 'North South', movement: 'north_south', green_seconds: 34, yellow_seconds: 3, all_red_seconds: 1 }, { name: 'East West', movement: 'east_west', green_seconds: 22, yellow_seconds: 3, all_red_seconds: 1 }] },
    { id: 'scenario-plan-2', junction_id: 8, plan_type: 'transit_priority', status: 'reference', cycle_seconds: 78, rationale: 'Scenario timing gives a short priority window to public transport.', phases: [{ name: 'North South', movement: 'north_south', green_seconds: 28, yellow_seconds: 3, all_red_seconds: 1 }, { name: 'East West', movement: 'east_west', green_seconds: 18, yellow_seconds: 3, all_red_seconds: 1 }] },
    { id: 'scenario-plan-3', junction_id: 4, plan_type: 'off_peak', status: 'reference', cycle_seconds: 65, rationale: 'Scenario timing reduces unnecessary waiting during lighter demand.', phases: [{ name: 'North South', movement: 'north_south', green_seconds: 24, yellow_seconds: 3, all_red_seconds: 1 }, { name: 'East West', movement: 'east_west', green_seconds: 15, yellow_seconds: 3, all_red_seconds: 1 }] },
  ];
  const registeredPlans = Array.isArray(plans) ? plans : [];
  // Reference timing strategies are offered only after a real plans-endpoint error.
  // A successful empty response stays empty instead of inventing registered plans.
  const previewMode = registeredPlans.length === 0 && fallbackReady;
  const list = registeredPlans.length ? registeredPlans : previewMode ? referencePlans : [];
  const selected = list.find((plan) => plan.id === selectedId) || list[0] || null;
  const phases = useMemo(() => selected?.phases || [], [selected]);
  const selectedPlanType = String(selected?.plan_type || '').toLowerCase();
  const previewClass = selectedPlanType.includes('peak') || selectedPlanType.includes('surge') ? 'network-heavy' : selectedPlanType.includes('transit') || selectedPlanType.includes('priority') || selectedPlanType.includes('adaptive') ? 'network-priority' : 'network-balanced';

  async function refreshPlans() {
    setRefreshing(true);
    try { await reload(); } finally { setRefreshing(false); }
  }

  function publishPlanImpact(plan) {
    const type = String(plan?.plan_type || '').toLowerCase();
    const scenario = type.includes('transit') || type.includes('priority') || type.includes('adaptive') ? 'signal_priority' : type.includes('peak') || type.includes('surge') ? 'demand_surge' : 'baseline';
    const label = scenario === 'signal_priority' ? 'Signal-priority sensitivity' : scenario === 'demand_surge' ? 'Higher demand' : 'Balanced flow';
    try { localStorage.setItem('urbansarthi.activeTrafficScenario', scenario); } catch { /* scenario will still be announced in this session */ }
    window.dispatchEvent(new CustomEvent('urbansarthi:traffic-scenario', { detail: { scenario, label } }));
    return label;
  }

  async function simulateSelected() {
    if (!selected) return notify('Select an existing scenario first.');
    setBusy(true); setNotice('');
    try {
      if (typeof selected.id === 'string' && selected.id.startsWith('scenario-plan-')) {
        const green = (selected.phases || []).reduce((sum, phase) => sum + Number(phase.green_seconds || 0), 0);
        const scenarioLabel = publishPlanImpact(selected);
        setNotice(`Scenario applied to Traffic Simulation with a ${selected.cycle_seconds}s cycle and ${green}s of green time. No physical signal controller is changed.`);
        notify(`Scenario published · ${scenarioLabel}`);
        return;
      }
      const result = await api.post(`/signals/plans/${selected.id}/simulate`, {});
      const scenarioLabel = publishPlanImpact(selected);
      setNotice(`Scenario applied to Traffic Simulation. No physical signal controller is changed.`);
      notify(result?.engine ? `Simulation complete · ${result.engine}` : `Scenario published · ${scenarioLabel}`);
      reload();
    } catch (err) { notify('The operation could not be completed. Please try again.'); }
    finally { setBusy(false); }
  }
  async function createPlan(event) {
    event.preventDefault();
    if (!junctionId) return notify('Choose a junction returned by the API.');
    setBusy(true);
    try {
      await api.post('/signals/plans', { junction_id: Number(junctionId), plan_type: 'manual', rationale: name, phases: [
        { name: 'North–South', movement: 'north_south', green_seconds: 26, yellow_seconds: 3, all_red_seconds: 1, demand_weight: 1 },
        { name: 'East–West', movement: 'east_west', green_seconds: 18, yellow_seconds: 3, all_red_seconds: 1, demand_weight: 1 },
      ] });
      notify('Timing plan created.'); setCreateOpen(false); await reload();
    } catch (err) { notify('The operation could not be completed. Please try again.'); }
    finally { setBusy(false); }
  }

  return <main className="monitor-page digital-twin-page">
    <PageIntro eyebrow="TRAFFIC SYSTEMS / DIGITAL TWIN" title="Digital Twin" description="Explore junction timing strategies, compare phase changes, and publish a reviewed what-if scenario to Traffic Simulation. Nothing is sent to physical traffic lights." action={<><button className="utility" onClick={() => navigate('/authority/traffic-simulation')}><Play size={14}/> Open simulation</button><button className="utility" onClick={refreshPlans} disabled={refreshing}><RefreshCw size={14} className={refreshing ? 'monitor-spin' : ''}/> Refresh plans</button><button className="primary" onClick={simulateSelected} disabled={busy || !selected}>{busy ? <LoaderCircle size={15} className="monitor-spin"/> : <Play size={15} />}{busy ? 'Applying…' : 'Apply selected plan'}</button></>} />
    {notice && <div className="notice"><Check size={15}/>{notice}</div>}
    <div className="signals-grid">
      <section className="panel plan-list"><div className="panel-head"><div><div className="eyebrow">AVAILABLE SCENARIOS</div><h3>Timing strategies</h3></div><button className="icon-btn" onClick={refreshPlans} aria-label="Refresh plans"><SlidersHorizontal size={16}/></button></div>
        {list.length ? list.map((plan) => <button className={`plan ${selected?.id === plan.id ? 'selected' : ''}`} key={plan.id} onClick={() => { setSelectedId(plan.id); setNotice(''); }}><span className="radio-dot"/><span className="plan-copy"><b>{plan.plan_type?.replaceAll('_', ' ') || 'Timing scenario'}</b><small>Junction {plan.junction_id}</small></span><span className="impact"><b>{seconds(plan.cycle_seconds)} cycle</b><small>{plan.status === 'reference' ? 'Available' : plan.status}</small></span></button>) : <EmptyState title="No timing plans yet" description="No timing plans were returned. Register a junction and create a timing plan to get started."/>}
        <button className="create-plan" onClick={() => setCreateOpen(!createOpen)} disabled={!Array.isArray(junctions) || junctions.length === 0}><Plus size={14}/> Create a new timing plan</button>
        {createOpen && <form className="create-plan-form" onSubmit={createPlan}><label>Junction<select value={junctionId} onChange={(e) => setJunctionId(e.target.value)} required><option value="">Select junction</option>{(junctions || []).map((j) => <option key={j.id} value={j.id}>{j.name} · ID {j.id}</option>)}</select></label><label>Plan rationale<input value={name} onChange={(e) => setName(e.target.value)} maxLength={3000} required/></label><button className="primary" type="submit" disabled={busy}>{busy ? <><LoaderCircle size={14} className="monitor-spin"/> Creating…</> : 'Create timing plan'}</button></form>}
      </section>
      <section className="panel preview"><div className="panel-head"><div><div className="eyebrow">SCENARIO DETAILS</div><h3>{selected ? `Junction ${selected.junction_id} · ${selected.plan_type?.replaceAll('_', ' ')}` : 'Select a plan'}</h3></div><span className="simulation">{selected ? (selected.status === 'reference' ? 'Available' : selected.status) : 'No plan selected'}</span></div>
        {selected ? <><div className={`intersection signal-network-preview ${previewClass}`}><div className="road-h"/><div className="road-v"/><div className="center-line h"/><div className="center-line v"/><span className="network-lane-label label-n">NORTH</span><span className="network-lane-label label-s">SOUTH</span><span className="network-lane-label label-w">WEST</span><span className="network-lane-label label-e">EAST</span><div className="signal-stack signal-stack-ns"><i className="lamp-red"/><i className="lamp-amber"/><i className="lamp-green"/></div><div className="signal-stack signal-stack-ew"><i className="lamp-red"/><i className="lamp-amber"/><i className="lamp-green"/></div><span className="time north">N/S {seconds(phases.find((p) => /north|south/i.test(p.movement || p.name))?.green_seconds)}</span><span className="time west">W {seconds(phases.find((p) => /west/i.test(p.movement || p.name))?.green_seconds)}</span><span className="time east">E {seconds(phases.find((p) => /east/i.test(p.movement || p.name))?.green_seconds)}</span><span className="time south">S {seconds(phases.find((p) => /south/i.test(p.movement || p.name))?.green_seconds)}</span><i className="network-car car-n1"/><i className="network-car car-n2"/><i className="network-car car-e1"/><i className="network-car car-w1"/><span className="network-plan-chip">{previewClass === 'network-heavy' ? 'HIGH DEMAND' : previewClass === 'network-priority' ? 'SIGNAL PRIORITY' : 'BALANCED FLOW'}</span></div>
          <div className="preview-stats"><div><small>Cycle length</small><b>{seconds(selected.cycle_seconds)}</b></div><div><small>Scenario status</small><b>{selected.status === 'reference' ? 'Available' : selected.status}</b></div><div><small>Phases</small><b>{phases.length}</b></div></div><div className="plan-rationale"><Zap size={16}/><span><b>Scenario rationale</b><small>{selected.rationale || 'No rationale was supplied.'}</small></span></div><div className="phase-list">{phases.map((phase, i) => <div key={`${phase.name}-${i}`}><b>{phase.name || phase.movement}</b><span>{phase.movement}</span><strong>{seconds(phase.green_seconds)} green</strong></div>)}</div><p className="api-note">This is a what-if scenario. It does not change physical traffic lights.</p></> : <EmptyState title="No scenario selected" description="Connect a junction and create a timing scenario to preview its phase timings."/>}
      </section>
    </div>
  </main>;
}
