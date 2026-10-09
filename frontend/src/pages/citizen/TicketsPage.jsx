import { useMemo, useState } from 'react';
import { Bus, CalendarClock, CheckCircle2, ClipboardList, RotateCcw, Ticket, XCircle } from 'lucide-react';
import PageIntro from '../../components/shared/PageIntro.jsx';
import { ErrorNotice, EmptyState } from '../../components/shared/Toast.jsx';
import useApiResource from '../../hooks/useApiResource.js';
import { api } from '../../services/api/client.js';
import { useApp } from '../../context/AppContext.jsx';
import { DEMO_TICKET_ORDERS } from '../../data/demoData.js';
import { cleanScenarioText } from '../../utils.js';

const dateLabel = (value) => value ? new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Departure time not set';
export default function TicketsPage() {
  const { notify } = useApp();
  const [mode, setMode] = useState('metro');
  const [origin, setOrigin] = useState('Rajiv Chowk');
  const [destination, setDestination] = useState('Akshardham');
  const [departure, setDeparture] = useState('');
  const [passengers, setPassengers] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [localRows, setLocalRows] = useState([]);
  const { data, loading, error, reload } = useApiResource(() => api.get('/ticketing/orders'), [], { fallback: DEMO_TICKET_ORDERS });
  const rows = useMemo(() => [...localRows, ...(Array.isArray(data) ? data : [])], [localRows, data]);
  const createOrder = async (event) => {
    event.preventDefault();
    if (origin.trim().toLowerCase() === destination.trim().toLowerCase()) return notify('Choose two different stops.');
    setSubmitting(true);
    const payload = { mode, origin_label: origin.trim(), destination_label: destination.trim(), departure_at: departure ? new Date(departure).toISOString() : null, passengers: Number(passengers) };
    try {
      const result = await api.post('/ticketing/orders', payload);
      notify('Journey request recorded. No ticket or payment was issued.');
      setLocalRows((previous) => [result, ...previous]);
      await reload();
    } catch {
      const local = { id: `local-${Date.now()}`, public_id: `US-REQ-${String(rows.length + 1).padStart(3, '0')}`, ...payload, status: 'requested', provider: 'not-configured', created_at: new Date().toISOString(), local_only: true };
      setLocalRows((previous) => [local, ...previous]);
      notify('Request preview saved in this browser only. The server has not received it.');
    } finally { setSubmitting(false); }
  };
  async function cancelOrder(order) {
    if (order.local_only || typeof order.id === 'string') {
      setLocalRows((previous) => previous.map((row) => row.id === order.id ? { ...row, status: 'cancelled' } : row));
      notify('Local request cancelled.'); return;
    }
    try { await api.post(`/ticketing/orders/${order.id}/cancel`); notify('Request cancelled.'); await reload(); }
    catch (err) { notify(cleanScenarioText(err.message) || 'Could not cancel this request.'); }
  }
  return <>
    <PageIntro eyebrow="JOURNEY REQUESTS" title="Transit ticket requests" description="Prepare a bus or metro journey request and track its status. Operator ticket issuance and payments are not connected." />
    <ErrorNotice message={error} onRetry={reload} />
    <div className="ticket-layout">
      <form className="panel ticket-form" onSubmit={createOrder}>
        <div className="panel-head"><div><div className="eyebrow">NEW REQUEST</div><h3>Plan your ride</h3></div><Ticket size={19}/></div>
        <div className="ticket-form-content">
          <label>Transport mode<select value={mode} onChange={(event) => setMode(event.target.value)}><option value="metro">Metro</option><option value="bus">Bus</option><option value="train">Train</option><option value="multimodal">Multimodal</option></select></label>
          <label>Origin<input value={origin} onChange={(event) => setOrigin(event.target.value)} required maxLength={180} placeholder="Starting station or stop" /></label>
          <label>Destination<input value={destination} onChange={(event) => setDestination(event.target.value)} required maxLength={180} placeholder="Destination station or stop" /></label>
          <label>Departure (optional)<input type="datetime-local" value={departure} onChange={(event) => setDeparture(event.target.value)} /></label>
          <label>Passengers<select value={passengers} onChange={(event) => setPassengers(event.target.value)}>{Array.from({ length: 12 }, (_, index) => index + 1).map((count) => <option key={count} value={count}>{count}</option>)}</select></label>
          <button className="primary full" type="submit" disabled={submitting}><ClipboardList size={16}/>{submitting ? 'Recording request…' : 'Create journey request'}</button>
          <div className="ticket-note"><CheckCircle2 size={16}/><span>A request reference is not a valid travel ticket. No payment is collected and no QR admission code is issued.</span></div>
        </div>
      </form>
      <section className="panel ticket-history">
        <div className="panel-head"><div><div className="eyebrow">REQUEST HISTORY</div><h3>{rows.length} requests</h3></div><button className="icon-btn" aria-label="Refresh requests" onClick={reload}><RotateCcw size={15}/></button></div>
        {loading && !rows.length ? <div className="loading-lines">Loading journey requests…</div> : rows.length ? rows.map((order) => <article className="ticket-row" key={order.id || order.public_id}>
          <div className="ticket-row-icon">{order.mode === 'bus' ? <Bus size={17}/> : <Ticket size={17}/>}</div>
          <div className="ticket-row-content"><b>{order.origin_label} <span>→</span> {order.destination_label}</b><small>{String(order.mode || 'transit').toUpperCase()} · {order.passengers || 1} passenger{order.passengers === 1 ? '' : 's'} · {dateLabel(order.departure_at)}</small><small>Reference: {String(order.public_id || '').startsWith('DEMO-') ? `US-REQ-${String(order.id).slice(-3).padStart(3, '0')}` : (order.public_id || 'Request recorded')}</small></div>
          <div className={`ticket-status ticket-${order.status || 'requested'}`}>{order.status || 'requested'}</div>
          {['requested','pending'].includes(order.status) && <button className="icon-btn ticket-cancel" aria-label="Cancel request" title="Cancel request" onClick={() => cancelOrder(order)}><XCircle size={15}/></button>}
        </article>) : <EmptyState title="No journey requests yet" description="Create a request to begin tracking its status here."/>}
        <div className="ticket-provider-status"><CalendarClock size={16}/><span><b>Ticketing provider not connected</b><small>Requests can be tracked, but are not confirmed bookings or tickets.</small></span></div>
      </section>
    </div>
  </>;
}
