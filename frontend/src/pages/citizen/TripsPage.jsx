import { useMemo, useState } from 'react';
import { ArrowRight, CalendarDays, Check, Download, Leaf, MapPin, Route, Timer, Train } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import PageIntro, { MetricCard } from '../../components/shared/PageIntro.jsx';
import { EmptyState, ErrorNotice } from '../../components/shared/Toast.jsx';
import useApiResource from '../../hooks/useApiResource.js';
import { api, endpoints } from '../../services/api/client.js';
import { useApp } from '../../context/AppContext.jsx';

const distance = (meters) => meters == null ? '—' : meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
const duration = (seconds) => seconds == null ? '—' : `${Math.max(1, Math.round(seconds / 60))} min`;
const dateText = (s) => s ? new Date(s).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Time not recorded';
export default function TripsPage() {
  const { notify } = useApp(); const navigate = useNavigate(); const [filter, setFilter] = useState('all'); const [selectedId, setSelectedId] = useState(null);
  const { data: trips, loading, error, reload } = useApiResource(() => api.get(endpoints.trips), []);
  const { data: mobility } = useApiResource(() => api.get(endpoints.myMobility), []);
  const list = Array.isArray(trips) ? trips : [];
  const filtered = useMemo(() => filter === 'all' ? list : list.filter((trip) => filter === 'this-week' ? Date.now() - new Date(trip.created_at).getTime() < 7 * 86400000 : Date.now() - new Date(trip.created_at).getTime() < 30 * 86400000), [list, filter]);
  const selected = filtered.find((trip) => trip.id === selectedId) || filtered[0] || null;
  async function updateTrip(action) {
    if (!selected) return;
    try { await api.post(`/trips/${selected.id}/${action}`); notify(`Trip ${action.replace('-', ' ')} successfully.`); await reload(); }
    catch (err) { notify(err.message); }
  }
  async function downloadReport() {
    const header = ['Trip reference','Origin','Destination','Status','Preference','Distance meters','Duration seconds','Created at'];
    const lines = [header, ...filtered.map((trip) => [trip.public_id, trip.origin_label, trip.destination_label, trip.status, trip.preference, trip.distance_meters, trip.duration_seconds, trip.created_at])].map((row) => row.map((v) => `"${String(v ?? '').replaceAll('"','""')}"`).join(','));
    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })); link.download = 'urbansaarthi-trip-report.csv'; link.click(); URL.revokeObjectURL(link.href);
  }
  return <>
    <PageIntro eyebrow="YOUR TRAVEL ACTIVITY" title="My trips" description="Review previous journeys, saved commutes and your recorded mobility activity." action={<button className="primary" disabled={!filtered.length} onClick={downloadReport}><Download size={15}/> Download trip report</button>} />
    <ErrorNotice message={error} onRetry={reload}/>
    <div className="analytics-kpis trip-kpis"><MetricCard icon={Route} label="Total trips" value={mobility?.total_trips ?? (error ? '—' : '—')} detail="Saved by the API"/><MetricCard icon={MapPin} label="Distance travelled" value={mobility?.recorded_distance_km == null ? '—' : `${mobility.recorded_distance_km} km`} detail="Completed saved trips"/><MetricCard icon={Leaf} label="CO₂ saved" value="—" detail="Not calculated by this API"/><MetricCard icon={Timer} label="Recorded travel time" value={mobility?.recorded_travel_hours == null ? '—' : `${mobility.recorded_travel_hours} hr`} detail="Saved journey records"/></div>
    <div className="trips-toolbar"><div className="range-tabs">{[['all','All trips'],['this-week','This week'],['this-month','This month']].map(([value,label])=><button className={filter===value?'active':''} key={value} onClick={()=>setFilter(value)}>{label}</button>)}</div><button className="utility" onClick={reload}><CalendarDays size={14}/> Refresh</button></div>
    <div className="trips-layout"><section className="panel trip-history"><div className="panel-head"><div><div className="eyebrow">JOURNEY HISTORY</div><h3>{filtered.length} saved {filtered.length === 1 ? 'trip' : 'trips'}</h3></div></div>{loading ? <div className="loading-lines">Loading saved trips…</div> : filtered.length ? filtered.map((trip) => <button key={trip.id} className={`trip-row ${selected?.id===trip.id?'selected':''}`} onClick={()=>setSelectedId(trip.id)}><span className="trip-icon"><Route size={16}/></span><span className="trip-row-main"><small>{dateText(trip.created_at)} · {trip.preference || 'Balanced'}</small><b>{trip.origin_label || 'Origin not supplied'}</b><span className="trip-destination">• {trip.destination_label || 'Destination not supplied'}</span><small className="trip-status">{trip.status?.replaceAll('_',' ') || 'Status unavailable'}</small></span><span className="trip-duration"><b>{duration(trip.duration_seconds)}</b><small>{distance(trip.distance_meters)}</small></span><ArrowRight size={15}/></button>) : <EmptyState title="No saved trips" description={error ? 'Sign in with the account used to create your trips. The API protects private travel history.' : 'Plan a journey and select an option to save a trip to your account.'}/> }</section>
      <section className="panel trip-detail"><div className="panel-head"><div><div className="eyebrow">TRIP DETAILS</div><h3>{selected ? dateText(selected.created_at) : 'Select a trip'}</h3></div>{selected && <span className={`trip-status-pill status-${selected.status}`}>{selected.status?.replaceAll('_',' ')}</span>}</div>
        {selected ? <><div className="trip-timeline"><div className="timeline-point start"><i/><div><small>Started from</small><b>{selected.origin_label || 'Origin not supplied'}</b><span>{distance(selected.distance_meters)} · {duration(selected.duration_seconds)}</span></div></div><div className="timeline-point end"><i/><div><small>Destination</small><b>{selected.destination_label || 'Destination not supplied'}</b></div></div></div><div className="trip-stat-grid"><div><small>Travel time</small><b>{duration(selected.duration_seconds)}</b></div><div><small>Distance</small><b>{distance(selected.distance_meters)}</b></div><div><small>Preference</small><b>{selected.preference || '—'}</b></div><div><small>Reference</small><b>{selected.public_id}</b></div></div><div className="cleaner-choice"><Leaf size={17}/><div><b>Data quality note</b><small>Distance and duration are values stored against the selected route. Emission estimates are not audited savings.</small></div></div><div className="trip-actions"><button className="secondary" onClick={() => navigate('/citizen/plan', { state: { from: selected.origin_label, to: selected.destination_label } })}><Route size={14}/> Repeat this trip</button>{selected.status === 'planned' && <button className="primary" onClick={() => updateTrip('start')}><Train size={14}/> Start trip</button>}{selected.status === 'in_progress' && <button className="primary" onClick={() => updateTrip('complete')}><Check size={14}/> Complete trip</button>}{['planned','in_progress'].includes(selected.status) && <button className="secondary" onClick={() => updateTrip('cancel')}>Cancel trip</button>}</div></> : <EmptyState title="Trip details" description="Select a saved journey to inspect its status, distance and available actions."/>}
      </section></div>
  </>;
}
