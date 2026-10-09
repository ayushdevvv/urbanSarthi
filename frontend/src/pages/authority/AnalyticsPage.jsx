import { useState } from 'react';
import { Activity, ArrowDownRight, ArrowUpRight, Cloud, Download, Leaf, RefreshCw, Route, TrendingDown } from 'lucide-react';
import PageIntro, { MetricCard } from '../../components/shared/PageIntro.jsx';
import { EmptyState, ErrorNotice } from '../../components/shared/Toast.jsx';
import useApiResource from '../../hooks/useApiResource.js';
import { api, endpoints } from '../../services/api/client.js';
import { createDemoCitySummary } from '../../data/demoData.js';

const value = (n, suffix = '') => n === null || n === undefined ? '—' : `${n.toLocaleString?.() ?? n}${suffix}`;
export default function AnalyticsPage() {
  const [range, setRange] = useState(7);
  const { data, loading, error, reload } = useApiResource(() => api.get(endpoints.citySummary(range)), [range], { fallback: () => createDemoCitySummary(range) });
  const exportReport = () => {
    if (!data) return;
    const rows = [['Metric', 'Value'], ['Period (days)', data.period_days], ['Trip requests', data.trip_requests], ['Completed trips', data.completed_trips], ['Cancelled trips', data.cancelled_trips], ['Recorded route distance km', data.recorded_route_distance_km], ['Note', data.note]];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); link.download = `urbansaarthi-city-analytics-${range}d.csv`; link.click(); URL.revokeObjectURL(link.href);
  };
  return <>
    <PageIntro eyebrow="MEASURED IMPACT" title="City analytics" description="Track network performance and recorded mobility activity for the selected period." action={<><select className="select" value={range} onChange={(e) => setRange(Number(e.target.value))}><option value={1}>24 hours</option><option value={7}>Last 7 days</option><option value={30}>30 days</option><option value={90}>Quarter</option></select><button className="primary" onClick={exportReport} disabled={!data}><Download size={15}/> Export report</button></>} />
    <ErrorNotice message={error} onRetry={reload}/>
    <div className="range-tabs">{[[1, '24 hours'], [7, '7 days'], [30, '30 days'], [90, 'Quarter']].map(([days, label]) => <button className={range === days ? 'active' : ''} onClick={() => setRange(days)} key={days}>{label}</button>)}</div>
    <div className="analytics-kpis">
      <MetricCard icon={Route} label="Trip requests" value={value(data?.trip_requests)} detail="Saved trip requests" />
      <MetricCard icon={Activity} label="Completed trips" value={value(data?.completed_trips)} detail="Recorded as completed" />
      <MetricCard icon={Cloud} label="Recorded distance" value={value(data?.recorded_route_distance_km, ' km')} detail="Distance stored in trip records" />
      <MetricCard icon={TrendingDown} label="Cancelled trips" value={value(data?.cancelled_trips)} detail="Requests cancelled in period" />
    </div>
    <div className="analytics-grid"><section className="panel chart-panel"><div className="panel-head"><div><div className="eyebrow">NETWORK-WIDE ACTIVITY</div><h3>Mobility activity summary</h3></div><button className="icon-btn" onClick={reload} aria-label="Refresh analytics"><RefreshCw size={15}/></button></div>
      {loading ? <div className="loading-lines">Loading analytics…</div> : data ? <div className="summary-chart"><div className="summary-chart-row"><span>Completed trips</span><div className="summary-track"><i style={{ width: `${Math.min(100, (data.completed_trips / Math.max(1, data.trip_requests)) * 100)}%` }}/></div><b>{value(data.completed_trips)}</b></div><div className="summary-chart-row"><span>Cancelled trips</span><div className="summary-track"><i className="cancelled" style={{ width: `${Math.min(100, (data.cancelled_trips / Math.max(1, data.trip_requests)) * 100)}%` }}/></div><b>{value(data.cancelled_trips)}</b></div><div className="summary-chart-row"><span>Recorded route distance</span><div className="summary-track"><i style={{ width: `${Math.min(100, data.recorded_route_distance_km / Math.max(1, data.recorded_route_distance_km) * 100)}%` }}/></div><b>{value(data.recorded_route_distance_km, ' km')}</b></div><p className="api-note">{data.note || 'Summary includes data returned by the city analytics endpoint.'}</p></div> : <EmptyState title="Analytics are unavailable" description="Ensure the backend is connected and contains scenario or recorded trip data."/>}
    </section><section className="panel ranking"><div className="panel-head"><div><div className="eyebrow">REPORT DETAILS</div><h3>Data coverage</h3></div></div><div className="coverage-row"><span>Selected period</span><b>{data?.period_days ? `${data.period_days} days` : '—'}</b></div><div className="coverage-row"><span>Trip requests</span><b>{value(data?.trip_requests)}</b></div><div className="coverage-row"><span>Completed</span><b>{value(data?.completed_trips)}</b></div><div className="coverage-row"><span>Distance available</span><b>{data?.recorded_route_distance_km == null ? '—' : 'Yes'}</b></div><div className="coverage-note"><Leaf size={16}/><span>{data?.note || 'Only saved trip records are included; anonymous route planning is not persisted.'}</span></div></section></div>
  </>;
}
