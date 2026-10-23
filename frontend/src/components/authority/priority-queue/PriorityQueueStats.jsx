import { Activity, AlertCircle, CircleDot, UserRound } from 'lucide-react';

export default function PriorityQueueStats({ stats, counts }) {
  const openCount = (counts?.open || 0) + (counts?.in_progress || 0);

  return (
    <section className="pq-stat-grid" aria-label="Priority queue summary">
      <div className="pq-stat">
        <div className="pq-stat-icon critical"><AlertCircle size={18} aria-hidden="true" /></div>
        <div><span>Critical items</span><b>{stats.critical}</b><small>Needs immediate review</small></div>
      </div>
      <div className="pq-stat">
        <div className="pq-stat-icon high"><Activity size={18} aria-hidden="true" /></div>
        <div><span>High priority</span><b>{stats.high}</b><small>Service or safety risk</small></div>
      </div>
      <div className="pq-stat">
        <div className="pq-stat-icon open"><CircleDot size={18} aria-hidden="true" /></div>
        <div><span>Open reports</span><b>{openCount}</b><small>Active queue backlog</small></div>
      </div>
      <div className="pq-stat">
        <div className="pq-stat-icon assign"><UserRound size={18} aria-hidden="true" /></div>
        <div><span>Unassigned</span><b>{stats.unassigned}</b><small>Needs an owner</small></div>
      </div>
    </section>
  );
}
