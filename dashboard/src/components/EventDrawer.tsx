import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { api, UnauthorizedError } from '../api/client';
import type { EventRecord } from '../api/types';
import { useStore } from '../store';
import { formatDateTime } from '../utils/format';
import { StatusBadge } from './StatusBadge';

interface Props {
  eventId: string;
  /** Changes whenever the list reloads, so the open event is re-fetched too. */
  version: number;
  onClose: () => void;
  /** Called after a replay is accepted so the list can reload. */
  onChanged: () => void;
}

type ReplayState = { state: 'idle' } | { state: 'pending' } | { state: 'done' } | { state: 'error'; message: string };

export function EventDrawer({ eventId, version, onClose, onChanged }: Props) {
  const apiKey = useStore((s) => s.apiKey);
  const signOut = useStore((s) => s.signOut);
  const [record, setRecord] = useState<EventRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replay, setReplay] = useState<ReplayState>({ state: 'idle' });
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Load (and re-load) the event.
  useEffect(() => {
    if (!apiKey) return;
    const controller = new AbortController();
    api
      .getEvent(apiKey, eventId, controller.signal)
      .then((loaded) => {
        setRecord(loaded);
        setError(null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof UnauthorizedError) {
          signOut(`${err.message} Enter it again.`);
          return;
        }
        setError(err instanceof Error ? err.message : 'Could not load this event.');
      });
    return () => controller.abort();
  }, [apiKey, eventId, version, signOut]);

  // Focus management: move focus in on open, give it back on close, close on Escape.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [onClose]);

  // Keep Tab inside the dialog while it is open.
  function trapFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const focusable = dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input, [tabindex]:not([tabindex="-1"])');
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function runReplay() {
    if (!apiKey) return;
    setReplay({ state: 'pending' });
    try {
      await api.replay(apiKey, eventId);
      setReplay({ state: 'done' });
      onChanged();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        signOut(`${err.message} Enter it again.`);
        return;
      }
      setReplay({ state: 'error', message: err instanceof Error ? err.message : 'Replay failed.' });
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={trapFocus}
      >
        <header className="drawer-header">
          <h2 id="drawer-title">{eventId}</h2>
          <button ref={closeRef} type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </header>

        {error && (
          <p role="alert" className="alert alert-error">
            {error}
          </p>
        )}
        {!record && !error && <p className="muted">Loading…</p>}

        {record && (
          <>
            <p>
              <StatusBadge status={record.status} />
            </p>

            {record.status === 'failed' && (
              <div className="replay">
                <button type="button" className="btn btn-primary" disabled={replay.state === 'pending'} onClick={runReplay}>
                  {replay.state === 'pending' ? 'Replaying…' : 'Replay this event'}
                </button>
                <p role="status" className="small">
                  {replay.state === 'done' && 'Replay scheduled. The event will move to Retrying, then Forwarded or Failed.'}
                  {replay.state === 'error' && <span className="error-text">{replay.message}</span>}
                </p>
              </div>
            )}

            {record.lastError && (
              <section>
                <h3>Last error</h3>
                <pre className="error-block">{record.lastError}</pre>
              </section>
            )}

            <section>
              <h3>Delivery</h3>
              <dl>
                <dt>Attempts</dt>
                <dd>{record.attempts}</dd>
                <dt>Received</dt>
                <dd>{formatDateTime(record.receivedAt)}</dd>
                <dt>Last updated</dt>
                <dd>{formatDateTime(record.updatedAt)}</dd>
                <dt>Forwarded</dt>
                <dd>{formatDateTime(record.forwardedAt)}</dd>
              </dl>
            </section>

            <section>
              <h3>Booking</h3>
              <dl>
                <dt>Customer</dt>
                <dd>{record.payload.customer.name}</dd>
                <dt>Email</dt>
                <dd>{record.payload.customer.email}</dd>
                <dt>Phone</dt>
                <dd>{record.payload.customer.phone ?? '—'}</dd>
                <dt>Service</dt>
                <dd>{record.payload.service}</dd>
                <dt>Starts at</dt>
                <dd>{formatDateTime(record.payload.startsAt)}</dd>
              </dl>
            </section>

            <section>
              <h3>Stored payload</h3>
              <pre>{JSON.stringify(record.payload, null, 2)}</pre>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
