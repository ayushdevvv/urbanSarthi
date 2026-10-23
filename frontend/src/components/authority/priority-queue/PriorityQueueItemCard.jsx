import { CircleDot, Clock3, Sparkles, UserRound } from 'lucide-react';
import { priorityStyle, statusLabel } from './constants.js';

export default function PriorityQueueItemCard({ item, actionId, onUpdate }) {
  const isUpdating = actionId === item.id;
  const priorityClass = priorityStyle[item.priority] || 'pq-medium';

  return (
    <article className="panel pq-item">
      <div className={`pq-score ${priorityClass}`}>
        <b>{item.priority_score}</b><small>/100</small><span>{item.priority}</span>
      </div>
      <div className="pq-item-main">
        <div className="pq-item-top">
          <div>
            <div className="pq-item-kickers">
              <span className={`pq-priority-tag ${priorityClass}`}>{item.priority}</span>
              <span className="pq-category">{item.category}</span>
              <span className="pq-id">#{String(item.id).padStart(4, '0')}</span>
            </div>
            <h4>{item.title}</h4>
          </div>
          <span className={`pq-status status-${item.status}`}>{statusLabel[item.status] || item.status}</span>
        </div>

        {item.description && <p className="pq-description">{item.description}</p>}

        <div className="pq-meta-row">
          <span><CircleDot size={13} aria-hidden="true" />{item.location || 'Location not specified'}</span>
          <span><Clock3 size={13} aria-hidden="true" />{item.created_at ? new Date(item.created_at).toLocaleString() : 'Time unavailable'}</span>
          <span><UserRound size={13} aria-hidden="true" />{item.assigned_to || 'Unassigned'}</span>
        </div>

        <div className="pq-ai-reason">
          <Sparkles size={14} aria-hidden="true" />
          <div>
            <b>Why this priority</b>
            <p>{item.ai_rationale}</p>
            {item.suggested_actions?.length > 0 && (
              <div className="pq-actions-suggested">
                {item.suggested_actions.map((action, index) => <span key={`${item.id}-${index}`}>{action}</span>)}
              </div>
            )}
            <small>Classifier: {item.ai_provider}</small>
          </div>
        </div>

        <div className="pq-item-actions">
          <label>
            Update status
            <select value={item.status} disabled={isUpdating} onChange={(event) => onUpdate(item, { status: event.target.value })}>
              <option value="open">Open</option>
              <option value="in_progress">In progress</option>
              <option value="resolved">Resolved</option>
              <option value="dismissed">Dismissed</option>
            </select>
          </label>
          <label>
            Assign to
            <input
              key={`${item.id}-${item.assigned_to || ''}`}
              defaultValue={item.assigned_to || ''}
              placeholder="Operator name / team"
              onBlur={(event) => {
                const nextValue = event.target.value.trim() || null;
                if (nextValue !== (item.assigned_to || null)) onUpdate(item, { assigned_to: nextValue });
              }}
            />
          </label>
          <button className="pq-secondary-button" disabled={isUpdating} onClick={() => onUpdate(item, { re_triage: true })}>
            <Sparkles size={14} aria-hidden="true" />{isUpdating ? 'Updating…' : 'Re-triage'}
          </button>
        </div>
      </div>
    </article>
  );
}
