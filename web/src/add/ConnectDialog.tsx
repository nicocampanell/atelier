import { useBackendStatus } from '../refs/backend';
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

/** Status + sign out only. Bearer comes from AuthGate / Supabase session — never paste a secret here. */
export function ConnectDialog({ onClose }: { onClose(): void }) {
  const status = useBackendStatus();
  const tone = status === 'connected' ? 'ok' : status === 'unreachable' || status === 'unauthorized' ? 'bad' : 'idle';

  return (
    <Dialog title="Backend" onClose={onClose}>
      <p className="dlg__status" role="status" data-tone={tone}>
        <span className="dlg__dot" aria-hidden="true" />
        {STATUS_TEXT[status]}
      </p>
      <p className="dlg__hint">Signed in via Supabase. Items save locally either way; when connected, uploads and links sync to your Atelier server.</p>
      <div className="dlg__row">
        <button type="button" className="dlg__btn dlg__btn--danger" disabled={status === 'off'} onClick={() => void signOut()}>
          Sign out
        </button>
        <span className="dlg__spacer" />
        <button type="button" className="dlg__btn" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}
