import type { Session } from '@supabase/supabase-js';
import { writeToken } from '../api/client';
import { connectBackend, disconnectBackend } from '../refs/backend';
import { supabase } from './supabase';

/** Keep localStorage bearer in sync with the Supabase access_token. */
export function applySession(session: Session | null): void {
  writeToken(session?.access_token ?? null);
}

/** Sign in, persist access_token, and kick the backend health check. */
export async function signIn(email: string, password: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  applySession(data.session);
  if (data.session?.access_token) await connectBackend(data.session.access_token);
}

/** Clear local bearer + Supabase session. */
export async function signOut(): Promise<void> {
  disconnectBackend();
  if (supabase) await supabase.auth.signOut().catch(() => {});
}

/** Hydrate bearer from the persisted Supabase session (refresh keeps writeToken current). */
export function bindSession(onChange: (session: Session | null) => void): () => void {
  if (!supabase) {
    onChange(null);
    return () => {};
  }
  let alive = true;
  void supabase.auth.getSession().then(({ data }) => {
    if (!alive) return;
    applySession(data.session);
    if (data.session?.access_token) void connectBackend(data.session.access_token);
    onChange(data.session);
  });
  const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
    applySession(session);
    if (event === 'SIGNED_OUT') {
      disconnectBackend();
      onChange(null);
      return;
    }
    if (session?.access_token && event === 'SIGNED_IN') void connectBackend(session.access_token);
    onChange(session);
  });
  return () => {
    alive = false;
    sub.subscription.unsubscribe();
  };
}
