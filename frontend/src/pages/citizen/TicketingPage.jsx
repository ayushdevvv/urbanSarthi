import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Bus, CheckCircle2, Clock3, CreditCard, RefreshCw, Ticket } from 'lucide-react';
import PageIntro from '../../components/shared/PageIntro.jsx';
import { ErrorNotice, EmptyState } from '../../components/shared/Toast.jsx';
import { api } from '../../services/api/client.js';

const initialTrip = { mode: 'metro', origin_label: 'Rajiv Chowk', destination_label: 'Akshardham', departure_at: '', passengers: 1 };

export default function TicketingPage() {
  const [provider, setProvider] = useState(null);
  const [orders, setOrders] = useState([]);
  const [trip, setTrip] = useState(initialTrip);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const status = await api.get('/ticketing/provider-status');
      setProvider(status);
      const owned = await api.get('/ticketing/orders');
      setOrders(owned || []);
    } catch (err) {
      setError(err.message || 'Ticket requests could not be loaded.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function requestTicket(event) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      const payload = { ...trip, passengers: Number(trip.passengers), departure_at: trip.departure_at ? new Date(trip.departure_at).toISOString() : null };
      if (payload.origin_label.trim().toLowerCase() === payload.destination_label.trim().toLowerCase()) throw new Error('Origin and destination must be different.');
      const order = await api.post('/ticketing/orders', payload);
      setMessage(`Journey request ${order.public_id} was saved. It is not a valid ticket or reservation.`);
      setTrip(initialTrip); await load();
    } catch (err) { setError(err.message || 'Could not save this journey request.'); }
    finally { setBusy(false); }
  }

  async function cancelOrder(order) {
    setError(''); setMessage('');
    try { await api.post(`/ticketing/orders/${order.id}/cancel`); setMessage('Journey request cancelled.'); await load(); }
    catch (err) { setError(err.message || 'Could not cancel this request.'); }
  }

  return <div className="ticketing-page">
    <PageIntro eyebrow="JOURNEY SERVICES" title="Travel requests" description="Save and track a journey request. Real ticket issuance, fares, seat reservations, QR codes and payments remain disabled until an authorized transit provider is connected." action={<button className="utility" onClick={load} disabled={loading}><RefreshCw size={15}/>{loading ? 'Refreshing…' : 'Refresh'}</button>} />
    <ErrorNotice message={error} onRetry={load}/>
    {message && <div className="notice ticket-success" role="status"><CheckCircle2 size={16}/>{message}</div>}
    <section className={`panel ticket-provider-banner ${provider?.connected ? 'connected' : 'not-connected'}`}><div className="ticket-provider-icon"><CreditCard size={22}/></div><div><b>{provider?.ticket_issuance_enabled ? 'Ticket provider connected' : 'Ticket provider not connected'}</b><p>{provider?.message || 'Provider status is being checked. Do not treat a request as a ticket.'}</p></div><span className="status-pill">{provider?.ticket_issuance_enabled ? 'ISSUANCE ENABLED' : 'REQUESTS ONLY'}</span></section>

    <div className="notice ticket-demo-notice" role="note"><AlertCircle size={16}/><span><b>Open hackathon demo.</b> Journey requests are stored in a shared demo workspace, not a private account. Please do not enter real personal or sensitive data.</span></div>
    <div className="ticketing-grid"><section className="panel ticket-request-panel"><div className="ticket-form-heading"><span className="eyebrow">NEW JOURNEY REQUEST</span><h3>Where are you heading?</h3><p>Shared demo workspace · no account required</p></div><form className="ticket-form" onSubmit={requestTicket}><label>Transport mode<select value={trip.mode} onChange={(e) => setTrip({ ...trip, mode: e.target.value })}><option value="metro">Metro</option><option value="bus">Bus</option><option value="train">Train</option><option value="ferry">Ferry</option><option value="multimodal">Multimodal</option></select></label><label>Origin<input required maxLength={180} value={trip.origin_label} onChange={(e) => setTrip({ ...trip, origin_label: e.target.value })}/></label><label>Destination<input required maxLength={180} value={trip.destination_label} onChange={(e) => setTrip({ ...trip, destination_label: e.target.value })}/></label><div className="ticket-form-row"><label>Departure (optional)<input type="datetime-local" value={trip.departure_at} onChange={(e) => setTrip({ ...trip, departure_at: e.target.value })}/></label><label>Passengers<select value={trip.passengers} onChange={(e) => setTrip({ ...trip, passengers: Number(e.target.value) })}>{Array.from({ length: 12 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}</select></label></div><button className="primary full" disabled={busy}><Ticket size={16}/>{busy ? 'Saving request…' : 'Save journey request'}</button><p className="ticket-legal-note"><AlertCircle size={15}/> This does not reserve a seat, quote a fare, issue a ticket or charge you.</p></form></section>
      <section className="panel ticket-orders-panel"><div className="ticket-form-heading"><span className="eyebrow">YOUR ACTIVITY</span><h3>Journey requests</h3><p>Shared demo history. QR codes appear only after a real provider confirms a ticket.</p></div>{loading ? <div className="loading-lines">Loading requests…</div> : orders.length ? <div className="ticket-orders-list">{orders.map((order) => <article className="ticket-order-card" key={order.id}><div className="ticket-order-mode">{order.mode === 'bus' ? <Bus size={18}/> : <Ticket size={18}/>}</div><div className="ticket-order-copy"><b>{order.origin_label} <span>→</span> {order.destination_label}</b><small>{order.mode.toUpperCase()} · {order.passengers} passenger{order.passengers === 1 ? '' : 's'}</small><small>{order.created_at ? new Date(order.created_at).toLocaleString() : 'Created time unavailable'}</small><p>{order.booking_response?.message || 'Request status only; check the provider before travel.'}</p></div><div className="ticket-order-side"><span className={`status-pill ticket-status-${order.status}`}>{order.status}</span>{['requested','pending'].includes(order.status) && <button className="utility" onClick={() => cancelOrder(order)}>Cancel request</button>}</div></article>)}</div> : <EmptyState title="No journey requests yet" description="Create a request on the left. It will be saved in the shared demo workspace, but it will not become a ticket until a transit provider confirms it."/>}</section></div>
    <div className="ticketing-bottom-note"><Clock3 size={15}/> Live arrivals and provider-issued tickets require an authorized GTFS Realtime / ticketing integration. The current screen is transparent about that boundary.</div>
  </div>;
}
