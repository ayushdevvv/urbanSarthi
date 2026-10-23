import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock3, Plus, RefreshCw, X } from 'lucide-react';
import PageIntro from '../../components/shared/PageIntro.jsx';
import { ErrorNotice, EmptyState } from '../../components/shared/Toast.jsx';
import PriorityQueueAIBanner from '../../components/authority/priority-queue/PriorityQueueAIBanner.jsx';
import PriorityQueueStats from '../../components/authority/priority-queue/PriorityQueueStats.jsx';
import PriorityQueueToolbar from '../../components/authority/priority-queue/PriorityQueueToolbar.jsx';
import PriorityQueueItemCard from '../../components/authority/priority-queue/PriorityQueueItemCard.jsx';
import CreatePriorityQueueItemModal from '../../components/authority/priority-queue/CreatePriorityQueueItemModal.jsx';
import { initialQueueForm } from '../../components/authority/priority-queue/constants.js';
import { api } from '../../services/api/client.js';

export default function PriorityQueuePage() {
  const [items, setItems] = useState([]);
  const [counts, setCounts] = useState({ open: 0, in_progress: 0, resolved: 0, dismissed: 0 });
  const [meta, setMeta] = useState({ groq_configured: false, model: null, human_review_required: true });
  const [statusFilter, setStatusFilter] = useState('active');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(initialQueueForm);
  const [saving, setSaving] = useState(false);
  const [actionId, setActionId] = useState(null);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (statusFilter !== 'all' && statusFilter !== 'active') params.set('status', statusFilter);
      if (statusFilter === 'active') params.set('status', 'active');
      if (priorityFilter !== 'all') params.set('priority', priorityFilter);
      if (search.trim()) params.set('search', search.trim());
      const [data, ai] = await Promise.all([
        api.get(`/priority-queue?${params}`),
        api.get('/priority-queue/meta'),
      ]);
      setItems(data.items || []);
      setCounts(data.counts || {});
      setMeta(ai || {});
    } catch (requestError) {
      setError(requestError.message || 'The priority queue could not be loaded.');
    } finally {
      setBusy(false);
    }
  }, [statusFilter, priorityFilter, search]);

  useEffect(() => {
    const timer = window.setTimeout(load, 180);
    return () => window.clearTimeout(timer);
  }, [load]);

  const stats = useMemo(() => ({
    critical: items.filter((item) => item.priority === 'critical' && !['resolved', 'dismissed'].includes(item.status)).length,
    high: items.filter((item) => item.priority === 'high' && !['resolved', 'dismissed'].includes(item.status)).length,
    unassigned: items.filter((item) => !item.assigned_to && !['resolved', 'dismissed'].includes(item.status)).length,
  }), [items]);

  async function createItem(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const created = await api.post('/priority-queue', form);
      setMessage(`Added to the queue as ${created.priority.toUpperCase()} priority (${created.priority_score}/100).`);
      setForm(initialQueueForm);
      setShowCreate(false);
      await load();
    } catch (requestError) {
      setError(requestError.message || 'Could not create queue item.');
    } finally {
      setSaving(false);
    }
  }

  async function updateItem(item, patch) {
    setActionId(item.id);
    setError('');
    setMessage('');
    try {
      await api.patch(`/priority-queue/${item.id}`, patch);
      setMessage(patch.re_triage ? 'Priority re-evaluated.' : 'Queue item updated.');
      await load();
    } catch (requestError) {
      setError(requestError.message || 'Could not update queue item.');
    } finally {
      setActionId(null);
    }
  }

  return (
    <div className="priority-page">
      <PageIntro
        eyebrow="CITY OPERATIONS · TRIAGE WORKSPACE"
        title="Priority queue"
        description="A ranked operational inbox for traffic, air-quality, infrastructure and service reports. Groq proposes priority; operators stay in control."
        action={(
          <>
            <button className="utility" onClick={load} disabled={busy}><RefreshCw size={15} aria-hidden="true" />{busy ? 'Refreshing…' : 'Refresh'}</button>
            <button className="primary" onClick={() => setShowCreate(true)}><Plus size={16} aria-hidden="true" /> Add report</button>
          </>
        )}
      />
      <ErrorNotice message={error} onRetry={load} />
      {message && (
        <div className="pq-success" role="status">
          <CheckCircle2 size={16} aria-hidden="true" /><span>{message}</span>
          <button onClick={() => setMessage('')} aria-label="Dismiss message"><X size={15} /></button>
        </div>
      )}

      <PriorityQueueAIBanner meta={meta} />
      <PriorityQueueStats stats={stats} counts={counts} />
      <PriorityQueueToolbar
        search={search}
        onSearchChange={setSearch}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        priorityFilter={priorityFilter}
        onPriorityFilterChange={setPriorityFilter}
        resultCount={items.length}
      />

      <div className="pq-list-head">
        <div><span className="eyebrow">OPERATIONS INBOX</span><h3>Highest risk first</h3></div>
        <span className="pq-sort-note"><Clock3 size={14} aria-hidden="true" /> Priority score, then age</span>
      </div>
      <div className="pq-items">
        {items.length ? items.map((item) => (
          <PriorityQueueItemCard key={item.id} item={item} actionId={actionId} onUpdate={updateItem} />
        )) : (
          <div className="panel">
            <EmptyState
              title={busy ? 'Loading operational queue…' : 'No reports match these filters'}
              description="Create an operational report, then the priority engine will score it and recommend next actions."
            />
          </div>
        )}
      </div>

      {showCreate && (
        <CreatePriorityQueueItemModal
          form={form}
          setForm={setForm}
          onClose={() => setShowCreate(false)}
          onSubmit={createItem}
          saving={saving}
        />
      )}
    </div>
  );
}
