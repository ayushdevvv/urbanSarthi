import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronRight, Play, Plus, RefreshCw, SlidersHorizontal, Zap } from 'lucide-react';
import PageIntro from '../../components/shared/PageIntro.jsx';
import { EmptyState, ErrorNotice } from '../../components/shared/Toast.jsx';
import useApiResource from '../../hooks/useApiResource.js';
import { api, endpoints } from '../../services/api/client.js';
import { useApp } from '../../context/AppContext.jsx';

const seconds = (n) => Number.isFinite(n) ? `${n}s` : '—';
export default function SignalPlansPage() {
  const { notify } = useApp();
  const navigate = useNavigate();
  const { data: plans, loading, error, reload } = useApiResource(() => api.get(endpoints.signalPlans), []);
  const { data: junctions } = useApiResource(() => api.get(endpoints.junctions), []);
  const [selectedId, setSelectedId] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [junctionId, setJunctionId] = useState('');
  const [name, setName] = useState('Operator submitted signal plan');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const referencePlans = [
    { id: 'scenario-plan-1', junction_id: 12, plan_type: 'adaptive_peak', status: 'reference', cycle_seconds: 90, rationale: 'Scenario timing balances the heavier north south flow.', phases: [{ name: 'North South', movement: 'north_south', green_seconds: 34, yellow_seconds: 3, all_red_seconds: 1 }, { name: 'East West', movement: 'east_west', green_seconds: 22, yellow_seconds: 3, all_red_seconds: 1 }] },
    { id: 'scenario-plan-2', junction_id: 8, plan_type: 'transit_priority', status: 'reference', cycle_seconds: 78, rationale: 'Scenario timing gives a short priority window to public transport.', phases: [{ name: 'North South', movement: 'north_south', green_seconds: 28, yellow_seconds: 3, all_red_seconds: 1 }, { name: 'East West', movement: 'east_west', green_seconds: 18, yellow_seconds: 3, all_red_seconds: 1 }] },
    { id: 'scenario-plan-3', junction_id: 4, plan_type: 'off_peak', status: 'reference', cycle_seconds: 65, rationale: 'Scenario timing reduces unnecessary waiting during lighter demand.', phases: [{ name: 'North South', movement: 'north_south', green_seconds: 24, yellow_seconds: 3, all_red_seconds: 1 }, { name: 'East West', movement: 'east_west', green_seconds: 15, yellow_seconds: 3, all_red_seconds: 1 }] },
  ];
  const list = Array.isArray(plans) && plans.length ? plans : referencePlans;
  const selected = list.find((plan) => plan.id === selectedId) || list[0] || null;
  const phases = useMemo(() => selected?.phases || [], [selected]);
  const selectedPlanType = String(selected?.plan_type || '').toLowerCase();
  const previewClass = selectedPlanType.includes('peak') || selectedPlanType.includes('surge') ? 'network-heavy' : selectedPlanType.includes('transit') || selectedPlanType.includes('priority') || selectedPlanType.includes('adaptive') ? 'network-priority' : 'network-balanced';

  function publishPlanImpact(plan) {
    const type = String(plan?.plan_type || '').toLowerCase();
    const scenario = type.includes('transit') || type.includes('priority') || type.includes('adaptive') ? 'signal_priority' : type.includes('peak') || type.includes('surge') ? 'demand_surge' : 'baseline';
    const label = scenario === 'signal_priority' ? 'Signal-priority sensitivity' : scenario === 'demand_surge' ? 'Higher demand' : 'Balanced flow';
    try { localStorage.setItem('urbansarthi.activeTrafficScenario', scenario); } catch { /* scenario will still be announced in this session */ }
    window.dispatchEvent(new CustomEvent('urbansarthi:traffic-scenario', { detail: { scenario, label } }));
    return label;
  }

  async function simulateSelected() {
    if (!selected) return notify('Select an existing plan first.');
    setBusy(true); setNotice('');
    try {
      if (typeof selected.id === 'string' && selected.id.startsWith('scenario-plan-')) {
        const green = (selected.phases || []).reduce((sum, phase) => sum + Number(phase.green_seconds || 0), 0);
        const scenarioLabel = publishPlanImpact(selected);
        setNotice(`Reference timing analysis completed for a ${selected.cycle_seconds}s cycle with ${green}s of green phases. Citizen road activity now follows the ${scenarioLabel.toLowerCase()} scenario. No physical controller is contacted.`);
        notify(`Scenario published · ${scenarioLabel}`);
        return;
      }
      const result = await api.post(`/signals/plans/${selected.id}/simulate`, {});
      const scenarioLabel = publishPlanImpact(selected);
      setNotice(`Analytical simulation completed. Citizen road activity now follows the ${scenarioLabel.toLowerCase()} scenario. Review the results before approval; no command was sent to physical traffic lights.`);
      notify(result?.engine ? `Simulation complete · ${result.engine}` : `Scenario published · ${scenarioLabel}`);
      reload();
    } catch (err) { notify(err.message); }
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
      notify('Signal plan created through the API.'); setCreateOpen(false); await reload();
    } catch (err) { notify(err.message); }
    finally { setBusy(false); }
  }

  return <>
    <PageIntro eyebrow="ADAPTIVE CONTROL" title="Signal plans" description="Review signal timing strategies and open a 60-minute what-if forecast for the selected network." action={<><button className="utility" onClick={() => navigate('/authority/traffic-model')}><Play size={14}/> Traffic Simulation</button><button className="utility" onClick={reload}><RefreshCw size={14}/> Refresh</button><button className="primary" onClick={simulateSelected} disabled={busy || !selected}><Play size={15}/>{busy ? 'Working…' : 'Apply selected plan'}</button></>} />
    <div className="notice scenario-notice"><Zap size={14}/>{plans?.length ? 'Signal plan overview' : 'Signal plan overview · Reference timing plans available'}</div>{notice && <div className="notice"><Check size={15}/>{notice}</div>}
    <div className="signals-grid">
      <section className="panel plan-list"><div className="panel-head"><div><div className="eyebrow">AVAILABLE PLANS</div><h3>Timing strategies</h3></div><button className="icon-btn" onClick={reload} aria-label="Refresh plans"><SlidersHorizontal size={16}/></button></div>
        {loading && !plans ? <div className="loading-lines">Loading signal plans…</div> : list.length ? list.map((plan) => <button className={`plan ${selected?.id === plan.id ? 'selected' : ''}`} key={plan.id} onClick={() => { setSelectedId(plan.id); const scenarioLabel = publishPlanImpact(plan); setNotice(`Preview updated · ${scenarioLabel}. Apply the plan to run its timing analysis.`); }}><span className="radio-dot"/><span className="plan-copy"><b>{plan.plan_type?.replaceAll('_', ' ') || 'Signal plan'}</b><small>Junction {plan.junction_id} · {String(plan.id).startsWith('scenario-plan-') ? 'reference plan' : plan.status}</small></span><span className="impact"><b>{seconds(plan.cycle_seconds)} cycle</b><small>{String(plan.id).startsWith('scenario-plan-') ? 'reference timing' : plan.status}</small></span></button>) : <EmptyState title="No signal plans yet" description="Choose a reference timing plan to review its timing assumptions."/>}
        <button className="create-plan" onClick={() => setCreateOpen(!createOpen)}><Plus size={14}/> Create a new signal plan</button>
        {createOpen && <form className="create-plan-form" onSubmit={createPlan}><label>Junction<select value={junctionId} onChange={(e) => setJunctionId(e.target.value)} required><option value="">Select junction</option>{(junctions || []).map((j) => <option key={j.id} value={j.id}>{j.name} · ID {j.id}</option>)}</select></label><label>Plan rationale<input value={name} onChange={(e) => setName(e.target.value)} maxLength={3000} required/></label><button className="primary" type="submit" disabled={busy}>Create through API</button></form>}
      </section>
      <section className="panel preview"><div className="panel-head"><div><div className="eyebrow">PLAN DETAILS</div><h3>{selected ? `Junction ${selected.junction_id} · ${selected.plan_type?.replaceAll('_', ' ')}` : 'Select a plan'}</h3></div><span className="simulation">{selected?.status || 'No plan selected'}</span></div>
        {selected ? <><div className={`intersection signal-network-preview ${previewClass}`}><div className="road-h"/><div className="road-v"/><div className="center-line h"/><div className="center-line v"/><span className="network-lane-label label-n">NORTH</span><span className="network-lane-label label-s">SOUTH</span><span className="network-lane-label label-w">WEST</span><span className="network-lane-label label-e">EAST</span><div className="signal-stack signal-stack-ns"><i className="lamp-red"/><i className="lamp-amber"/><i className="lamp-green"/></div><div className="signal-stack signal-stack-ew"><i className="lamp-red"/><i className="lamp-amber"/><i className="lamp-green"/></div><span className="time north">N/S {seconds(phases.find((p) => /north|south/i.test(p.movement || p.name))?.green_seconds)}</span><span className="time west">W {seconds(phases.find((p) => /west/i.test(p.movement || p.name))?.green_seconds)}</span><span className="time east">E {seconds(phases.find((p) => /east/i.test(p.movement || p.name))?.green_seconds)}</span><span className="time south">S {seconds(phases.find((p) => /south/i.test(p.movement || p.name))?.green_seconds)}</span><i className="network-car car-n1"/><i className="network-car car-n2"/><i className="network-car car-e1"/><i className="network-car car-w1"/><span className="network-plan-chip">{previewClass === 'network-heavy' ? 'HIGH DEMAND' : previewClass === 'network-priority' ? 'SIGNAL PRIORITY' : 'BALANCED FLOW'}</span></div>
          <div className="preview-stats"><div><small>Signal cycle</small><b>{seconds(selected.cycle_seconds)}</b></div><div><small>Plan status</small><b>{selected.status}</b></div><div><small>Phases</small><b>{phases.length}</b></div></div><div className="plan-rationale"><Zap size={16}/><span><b>Plan rationale</b><small>{selected.rationale || 'No rationale was supplied.'}</small></span></div><div className="phase-list">{phases.map((phase, i) => <div key={`${phase.name}-${i}`}><b>{phase.name || phase.movement}</b><span>{phase.movement}</span><strong>{seconds(phase.green_seconds)} green</strong></div>)}</div><p className="api-note">Simulation is an analytical scenario result. It does not write to physical traffic lights.</p></> : <EmptyState title="No plan selected" description="Connect a junction and create a signal plan to preview its phase timings."/>}
      </section>
    </div>
  </>;
}
