import { ArrowDownWideNarrow, Filter, Search } from 'lucide-react';

export default function PriorityQueueToolbar({
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  priorityFilter,
  onPriorityFilterChange,
  resultCount,
}) {
  return (
    <section className="pq-toolbar panel" aria-label="Filter operational reports">
      <label className="pq-search">
        <Search size={17} aria-hidden="true" />
        <input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search reports, locations, details…"
          aria-label="Search reports"
        />
      </label>
      <label className="pq-filter">
        <Filter size={15} aria-hidden="true" />
        <select aria-label="Filter by status" value={statusFilter} onChange={(event) => onStatusFilterChange(event.target.value)}>
          <option value="active">Active items</option>
          <option value="open">Open</option>
          <option value="in_progress">In progress</option>
          <option value="resolved">Resolved</option>
          <option value="dismissed">Dismissed</option>
          <option value="all">All statuses</option>
        </select>
      </label>
      <label className="pq-filter">
        <ArrowDownWideNarrow size={15} aria-hidden="true" />
        <select aria-label="Filter by priority" value={priorityFilter} onChange={(event) => onPriorityFilterChange(event.target.value)}>
          <option value="all">All priorities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </label>
      <span className="pq-result-count">{resultCount} shown</span>
    </section>
  );
}
