import { useState, type FormEvent } from 'react';
import { useStore } from '../store';

export function KeyGate() {
  const connect = useStore((s) => s.connect);
  const authError = useStore((s) => s.authError);
  const [key, setKey] = useState('');

  function submit(event: FormEvent) {
    event.preventDefault();
    if (key.trim()) connect(key);
  }

  return (
    <main className="gate">
      <form className="card gate-card" onSubmit={submit}>
        <h1>Booking Webhook Relay</h1>
        <p className="muted">Enter the admin API key to view events.</p>

        {authError && (
          <p role="alert" className="alert alert-error">
            {authError}
          </p>
        )}

        <label htmlFor="api-key">Admin API key</label>
        <input
          id="api-key"
          type="password"
          autoComplete="off"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          aria-describedby="api-key-help"
        />
        <p id="api-key-help" className="muted small">
          The key is kept in memory only. You will be asked again if you refresh the page.
        </p>

        <button type="submit" className="btn btn-primary" disabled={!key.trim()}>
          Connect
        </button>
      </form>
    </main>
  );
}
