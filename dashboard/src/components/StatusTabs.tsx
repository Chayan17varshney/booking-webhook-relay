import { STATUSES, type StatusCounts } from '../api/types';
import { useStore, type StatusFilter } from '../store';
import { STATUS_LABELS } from './StatusBadge';

const OPTIONS: StatusFilter[] = ['all', ...STATUSES];

export function StatusTabs({ counts }: { counts: StatusCounts | null }) {
  const statusFilter = useStore((s) => s.statusFilter);
  const setStatusFilter = useStore((s) => s.setStatusFilter);

  return (
    <div className="tabs" role="group" aria-label="Filter by status">
      {OPTIONS.map((option) => {
        const label = option === 'all' ? 'All' : STATUS_LABELS[option];
        const count = counts ? (option === 'all' ? counts.total : counts[option]) : null;
        return (
          <button
            key={option}
            type="button"
            className={`tab${statusFilter === option ? ' tab-active' : ''}`}
            aria-pressed={statusFilter === option}
            onClick={() => setStatusFilter(option)}
          >
            {label}
            {count !== null && <span className="tab-count">{count}</span>}
          </button>
        );
      })}
    </div>
  );
}
