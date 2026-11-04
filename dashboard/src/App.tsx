import { useCallback } from 'react';
import { EventDrawer } from './components/EventDrawer';
import { EventsTable } from './components/EventsTable';
import { KeyGate } from './components/KeyGate';
import { STATUS_LABELS } from './components/StatusBadge';
import { StatusTabs } from './components/StatusTabs';
import { useEvents } from './hooks/useEvents';
import { PAGE_SIZE, useStore } from './store';

function Dashboard() {
  const { events, counts, loading, error, lastUpdated, refresh, version } = useEvents();
  const statusFilter = useStore((s) => s.statusFilter);
  const page = useStore((s) => s.page);
  const setPage = useStore((s) => s.setPage);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const autoRefresh = useStore((s) => s.autoRefresh);
  const setAutoRefresh = useStore((s) => s.setAutoRefresh);
  const signOut = useStore((s) => s.signOut);

  const closeDrawer = useCallback(() => select(null), [select]);

  const total = events?.total ?? 0;
  const first = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const last = Math.min((page + 1) * PAGE_SIZE, total);
  const hasNext = (page + 1) * PAGE_SIZE < total;

  return (
    <div className="app">
      <header className="topbar">
        <h1>Booking Webhook Relay</h1>
        <div className="topbar-actions">
          {lastUpdated && <span className="muted small">Updated {lastUpdated.toLocaleTimeString()}</span>}
          <label className="check">
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
            Auto-refresh (10 s)
          </label>
          <button type="button" className="btn" onClick={refresh} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button type="button" className="btn" onClick={() => signOut()}>
            Sign out
          </button>
        </div>
      </header>

      <main>
        <StatusTabs counts={counts} />

        {error && (
          <div role="alert" className="alert alert-error">
            {error}{' '}
            <button type="button" className="btn" onClick={refresh}>
              Try again
            </button>
          </div>
        )}

        {!events && loading && <p className="muted">Loading events…</p>}

        {events && events.items.length === 0 && (
          <p className="empty">
            {statusFilter === 'all'
              ? 'No events yet. Send a signed webhook to see it here.'
              : `No ${STATUS_LABELS[statusFilter].toLowerCase()} events.`}
          </p>
        )}

        {events && events.items.length > 0 && (
          <>
            <EventsTable items={events.items} selectedId={selectedId} onSelect={select} />
            <nav className="pager" aria-label="Pagination">
              <span className="muted small">
                Showing {first}–{last} of {total}
              </span>
              <button type="button" className="btn" disabled={page === 0} onClick={() => setPage(page - 1)}>
                Previous
              </button>
              <button type="button" className="btn" disabled={!hasNext} onClick={() => setPage(page + 1)}>
                Next
              </button>
            </nav>
          </>
        )}
      </main>

      {selectedId && <EventDrawer eventId={selectedId} version={version} onClose={closeDrawer} onChanged={refresh} />}
    </div>
  );
}

export default function App() {
  const apiKey = useStore((s) => s.apiKey);
  return apiKey ? <Dashboard /> : <KeyGate />;
}
