import { useState } from 'react';
import { Activity, Cloud, Download, Leaf, RefreshCw, Route, TrendingDown } from 'lucide-react';
import PageIntro, { MetricCard } from '../../components/shared/PageIntro.jsx';
import { EmptyState } from '../../components/shared/Toast.jsx';
import useApiResource from '../../hooks/useApiResource.js';
import { api, endpoints } from '../../services/api/client.js';

const value = (n, suffix = '') => n === null || n === undefined ? '—' : `${n.toLocaleString?.() ?? n}${suffix}`;
const previewSummary = (period) => ({
  period_days: period, trip_requests: 1248, completed_trips: 986, cancelled_trips: 74,
  recorded_route_distance_km: 4832,
  note: 'Illustrative mobility profile for interface review. It is not a live city measurement.',
});

export default function AnalyticsPage() {
  const [range, setRange] = useState(7);
  const { data, loading, error, reload, fallbackReady } = useApiResource(() => api.get(endpoints.citySummary(range)), [range]);
  const previewMode = !data && fallbackReady;
  const shown = data || (previewMode ? previewSummary(range) : null);
  const exportReport = () => {
    if (!shown) return;
    const rows = [['Metric', 'Value'], ['Period (days)', shown.period_days], ['Trip requests', shown.trip_requests], ['Completed trips', shown.completed_trips], ['Cancelled trips', shown.cancelled_trips], ['Recorded route distance km', shown.recorded_route_distance_km], ['Note', shown.note]];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); link.download = `city-analytics-${range}d.csv`; link.click(); URL.revokeObjectURL(link.href);
  };
  const completionPct = shown ? Math.min(100, (shown.completed_trips / Math.max(1, shown.trip_requests)) * 100) : 0;
  const cancelPct = shown ? Math.min(100, (shown.cancelled_trips / Math.max(1, shown.trip_requests)) * 100) : 0;

  return <>
    <PageIntro eyebrow="INTEGRATED COMMAND CENTRE" title="City analytics" description="Review mobility activity, trip outcomes and citywide performance." action={<><select className="select" value={range} onChange={(e) => setRange(Number(e.target.value))}><option value={1}>24 hours</option><option value={7}>Last 7 days</option><option value={30}>30 days</option><option value={90}>Quarter</option></select><button className="primary" onClick={exportReport} disabled={!shown}><Download size={15}/> Export report</button><button className="utility" onClick={reload} disabled={loading}><RefreshCw size={14}/> {loading ? 'Refreshing…' : 'Refresh'}</button></>} />
    <div className="range-tabs">{[[1, '24 hours'], [7, '7 days'], [30, '30 days'], [90, 'Quarter']].map(([days, label]) => <button className={range === days ? 'active' : ''} onClick={() => setRange(Number(days))} key={days}>{label}</button>)}</div>
    {!shown ? <section className="panel us-connection-card" aria-live="polite"><div className="us-connection-icon"><Activity size={22}/></div><h3>{loading ? 'Loading city analytics' : 'City analytics are being prepared'}</h3><p>{loading ? 'Loading the selected reporting period.' : 'The selected reporting period could not be refreshed. Retry to check for the latest records.'}</p><button className="primary" onClick={reload} disabled={loading}><RefreshCw size={15}/>Retry live data</button></section> : <>
      <div className={`notice scenario-notice ${previewMode ? 'notice-preview' : ''}`}><Activity size={14}/>{previewMode ? 'Illustrative analytics preview · reference values only' : 'City analytics · live data'}</div>
      <div className="analytics-kpis">
        <MetricCard icon={Route} label="Trip requests" value={value(shown.trip_requests)} detail="Mobility requests" />
        <MetricCard icon={Activity} label="Completed trips" value={value(shown.completed_trips)} detail="Completed journeys" />
        <MetricCard icon={Cloud} label="Recorded distance" value={value(shown.recorded_route_distance_km, ' km')} detail="Journey distance" />
        <MetricCard icon={TrendingDown} label="Cancelled trips" value={value(shown.cancelled_trips)} detail="Cancelled requests" />
      </div>
      <div className="analytics-grid">
        <section className="panel chart-panel">
          <div className="panel-head"><div><div className="eyebrow">NETWORK ACTIVITY</div><h3>Mobility activity summary</h3></div><button className="icon-btn" onClick={reload} aria-label="Refresh analytics" disabled={loading}><RefreshCw size={15}/></button></div>
          <div className="summary-chart"><div className="summary-chart-row"><span>Completed trips</span><div className="summary-track"><i style={{ width: `${completionPct}%` }}/></div><b>{value(shown.completed_trips)}</b></div><div className="summary-chart-row"><span>Cancelled trips</span><div className="summary-track"><i className="cancelled" style={{ width: `${cancelPct}%` }}/></div><b>{value(shown.cancelled_trips)}</b></div><div className="summary-chart-row"><span>Recorded route distance</span><div className="summary-track"><i style={{ width: '100%' }}/></div><b>{value(shown.recorded_route_distance_km, ' km')}</b></div><p className="api-note">{shown.note}</p></div>
        </section>
        <section className="panel ranking"><div className="panel-head"><div><div className="eyebrow">REPORT DETAILS</div><h3>Data coverage</h3></div></div><div className="coverage-row"><span>Selected period</span><b>{shown.period_days} days</b></div><div className="coverage-row"><span>Trip requests</span><b>{value(shown.trip_requests)}</b></div><div className="coverage-row"><span>Completed</span><b>{value(shown.completed_trips)}</b></div><div className="coverage-row"><span>Distance available</span><b>{shown.recorded_route_distance_km == null ? 'No' : 'Yes'}</b></div><div className="coverage-note"><Leaf size={16}/><span>{shown.note}</span></div>{!previewMode && <button className="utility analytics-refresh-action" onClick={reload} disabled={loading}><RefreshCw size={14}/>Refresh report</button>}</section>
      </div>
    </>}
  </>;
}
