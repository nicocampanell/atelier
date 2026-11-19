import { useState, type FormEvent } from 'react';
import { useBackendStatus } from '../refs/backend';
import { connectBackend } from '../api/client';
import { signOut } from '../auth/session';
import type { BackendStatus } from '../refs/contracts';
import { Dialog } from './Dialog';

const STATUS_TEXT: Record<BackendStatus, string> = {
  off: 'Not connected',
  checking: 'Checking…',
  connected: 'Connected',
  unreachable: 'Can’t reach the backend',
  unauthorized: 'Token rejected',
};

/** The token is typed here and never shown again: the field is cleared after every attempt. */
export function ConnectDialog({ onClose }: { onClose(): void }) {
  const status = useBackendStatus();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const t = token.trim();
    if (!t || busy) return;
    setBusy(true);
    setToken('');
    try {
      await connectBackend(t);
    } finally {
      setBusy(false);
    }
  };

  const tone = status === 'connected' ? 'ok' : status === 'unreachable' || status === 'unauthorized' ? 'bad' : 'idle';

  return (
    <Dialog title="Connect backend" onClose={onClose}>
      <form onSubmit={submit} autoComplete="off">
        <p className="dlg__status" role="status" data-tone={tone}>
          <span className="dlg__dot" aria-hidden="true" />
          {STATUS_TEXT[status]}
        </p>
        <input
          data-autofocus
          className="dlg__input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={status === 'connected' ? 'Enter a new token to replace it' : 'Access token'}
          aria-label="Access token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        <p className="dlg__hint">Items save locally either way. When connected, uploads and links are also saved to your Atelier server.</p>
        <div className="dlg__row">
          <button
            type="button"
            className="dlg__btn dlg__btn--danger"
            disabled={status === 'off'}
            onClick={() => {
              void signOut();
              setToken('');
            }}
          >
            Disconnect
          </button>
          <span className="dlg__spacer" />
          <button type="button" className="dlg__btn" onClick={onClose}>
            Close
          </button>
          <button type="submit" className="dlg__btn dlg__btn--primary" disabled={!token.trim() || busy}>
            Connect
          </button>
        </div>
      </form>
    </Dialog>
  );
}
