import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useBackendStatus } from '../refs/backend';
import '../add/add.css';
import { bindSession, signIn, signOut } from './session';
import { supabase } from './supabase';

/**
 * Blocks the canvas until there is a Supabase email/password session.
 * On backend 401 (unauthorized status), clears the session and shows sign-in again.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const backend = useBackendStatus();

  useEffect(() => bindSession((s) => {
    setSession(s);
    setReady(true);
  }), []);

  useEffect(() => {
    if (backend === 'unauthorized' && session) void signOut();
  }, [backend, session]);

  if (!ready) {
    return (
      <div className="dlg-scrim" style={{ background: 'var(--shell-bg)' }}>
        <p className="dlg__hint" role="status">
          Checking session…
        </p>
      </div>
    );
  }

  if (!supabase) {
    return (
      <div className="dlg-scrim" style={{ background: 'var(--shell-bg)' }}>
        <div className="dlg" role="alert">
          <h2 className="dlg__title">Missing auth config</h2>
          <p className="dlg__hint">
            Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>, then rebuild.
          </p>
        </div>
      </div>
    );
  }

  if (!session) {
    const submit = async (e: FormEvent) => {
      e.preventDefault();
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        await signIn(email.trim(), password);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Sign-in failed.');
      } finally {
        setBusy(false);
        setPassword('');
      }
    };

    return (
      <div className="dlg-scrim" style={{ background: 'var(--shell-bg)' }}>
        <div className="dlg" role="dialog" aria-labelledby="auth-title" aria-modal="true">
          <h2 id="auth-title" className="dlg__title">
            Sign in
          </h2>
          <form onSubmit={submit}>
            <label className="dlg__hint" htmlFor="auth-email" style={{ display: 'block', marginBottom: 6 }}>
              Email
            </label>
            <input
              id="auth-email"
              className="dlg__input"
              type="email"
              name="email"
              autoComplete="username"
              required
              spellCheck={false}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ fontSize: 16 }}
            />
            <label className="dlg__hint" htmlFor="auth-password" style={{ display: 'block', margin: '12px 0 6px' }}>
              Password
            </label>
            <input
              id="auth-password"
              className="dlg__input"
              type="password"
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ fontSize: 16 }}
            />
            {error && (
              <p className="dlg__error" role="alert">
                {error}
              </p>
            )}
            <div className="dlg__row">
              <button type="submit" className="dlg__btn dlg__btn--primary" disabled={busy || !email.trim() || !password}>
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
