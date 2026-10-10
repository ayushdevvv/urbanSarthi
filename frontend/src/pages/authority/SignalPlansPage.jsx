import { useMemo, useState } from 'react';
import { Check, ChevronRight, Play, Plus, RefreshCw, SlidersHorizontal, Zap } from 'lucide-react';
import PageIntro from '../../components/shared/PageIntro.jsx';
import { EmptyState, ErrorNotice } from '../../components/shared/Toast.jsx';
import useApiResource from '../../hooks/useApiResource.js';
import { api, endpoints } from '../../services/api/client.js';
import { useApp } from '../../context/AppContext.jsx';

const seconds = (n) => Number.isFinite(n) ? `${n}s` : '—';
export default function SignalPlansPage() {
  const { notify } = useApp();
  const { data: plans, loading, error, reload } = useApiResource(() => api.get(endpoints.signalPlans), []);
  const { data: junctions } = useApiResource(() => api.get(endpoints.junctions), []);
  const [selectedId, setSelectedId] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [junctionId, setJunctionId] = useState('');
  const [name, setName] = useState('Operator submitted signal plan');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const list = Array.isArray(plans) ? plans : [];
  const selected = list.find((plan) => plan.id === selectedId) || list[0] || null;
  const phases = useMemo(() => selected?.phases || [], [selected]);

  async function simulateSelected() {
    if (!selected) return notify('Select an existing plan first.');
    setBusy(true); setNotice('');
    try {
      const result = await api.post(`/signals/plans/${selected.id}/simulate`, {});
      setNotice('Analytical simulation completed. Review the results before approval; no command was sent to physical traffic lights.');
      notify(result?.engine ? `Simulation complete · ${result.engine}` : 'Simulation completed');
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
    <PageIntro eyebrow="ADAPTIVE CONTROL" title="Signal plans" description="Review predicted impact, test timing changes and deploy a coordinated plan." action={<><button className="utility" onClick={reload}><RefreshCw size={14}/> Refresh</button><button className="primary" onClick={simulateSelected} disabled={busy || !selected}><Play size={15}/>{busy ? 'Working…' : 'Apply selected plan'}</button></>} />
    <ErrorNotice message={error} onRetry={reload}/>{notice && <div className="notice"><Check size={15}/>{notice}</div>}
    <div className="signals-grid">
      <section className="panel plan-list"><div className="panel-head"><div><div className="eyebrow">AVAILABLE PLANS</div><h3>Timing strategies</h3></div><button className="icon-btn" onClick={reload} aria-label="Refresh plans"><SlidersHorizontal size={16}/></button></div>
        {loading ? <div className="loading-lines">Loading signal plans…</div> : list.length ? list.map((plan) => <button className={`plan ${selected?.id === plan.id ? 'selected' : ''}`} key={plan.id} onClick={() => setSelectedId(plan.id)}><span className="radio-dot"/><span className="plan-copy"><b>{plan.plan_type?.replaceAll('_', ' ') || 'Signal plan'}</b><small>Junction {plan.junction_id} · {plan.status}</small></span><span className="impact"><b>{seconds(plan.cycle_seconds)} cycle</b><small>{plan.status}</small></span></button>) : <EmptyState title="No signal plans yet" description="Plans appear here once the backend has stored them. You can create one if a junction is available."/>}
        <button className="create-plan" onClick={() => setCreateOpen(!createOpen)}><Plus size={14}/> Create a new signal plan</button>
        {createOpen && <form className="create-plan-form" onSubmit={createPlan}><label>Junction<select value={junctionId} onChange={(e) => setJunctionId(e.target.value)} required><option value="">Select junction</option>{(junctions || []).map((j) => <option key={j.id} value={j.id}>{j.name} · ID {j.id}</option>)}</select></label><label>Plan rationale<input value={name} onChange={(e) => setName(e.target.value)} maxLength={3000} required/></label><button className="primary" type="submit" disabled={busy}>Create through API</button></form>}
      </section>
      <section className="panel preview"><div className="panel-head"><div><div className="eyebrow">PLAN DETAILS</div><h3>{selected ? `Junction ${selected.junction_id} · ${selected.plan_type?.replaceAll('_', ' ')}` : 'Select a plan'}</h3></div><span className="simulation">{selected?.status || 'No plan selected'}</span></div>
        {selected ? <><div className="intersection"><div className="road-h"/><div className="road-v"/><div className="center-line h"/><div className="center-line v"/><div className="light"><i/><i/><i/></div><span className="time north">N/S {seconds(phases.find((p) => /north|south/i.test(p.movement || p.name))?.green_seconds)}</span><span className="time west">W {seconds(phases.find((p) => /west/i.test(p.movement || p.name))?.green_seconds)}</span><span className="time east">E {seconds(phases.find((p) => /east/i.test(p.movement || p.name))?.green_seconds)}</span><span className="time south">S {seconds(phases.find((p) => /south/i.test(p.movement || p.name))?.green_seconds)}</span></div>
          <div className="preview-stats"><div><small>Signal cycle</small><b>{seconds(selected.cycle_seconds)}</b></div><div><small>Plan status</small><b>{selected.status}</b></div><div><small>Phases</small><b>{phases.length}</b></div></div><div className="plan-rationale"><Zap size={16}/><span><b>Plan rationale</b><small>{selected.rationale || 'No rationale was supplied.'}</small></span></div><div className="phase-list">{phases.map((phase, i) => <div key={`${phase.name}-${i}`}><b>{phase.name || phase.movement}</b><span>{phase.movement}</span><strong>{seconds(phase.green_seconds)} green</strong></div>)}</div><p className="api-note">Simulation is an analytical scenario result. It does not write to physical traffic lights.</p></> : <EmptyState title="No plan selected" description="Connect a junction and create a signal plan to preview its phase timings."/>}
      </section>
    </div>
  </>;
}
