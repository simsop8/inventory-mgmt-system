import React, { createContext, useContext, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, cloudSyncEnabled } from '../lib/supabaseClient';

interface AuthContextValue {
  session: Session | null;
  loading: boolean;
  cloudSyncEnabled: boolean;
  // Set when Supabase redirects back with an OAuth error (e.g. the Google
  // account isn't on the staff allow-list, so account creation was blocked
  // server-side) or when a previously-approved account gets signed out
  // because it was removed from the allow-list. Null when there's nothing
  // to show.
  authError: string | null;
  clearAuthError: () => void;
  signInWithGoogle: () => Promise<void>;
  switchAccount: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Remembers the last email that successfully signed in on this device, so a
// future signInWithGoogle() can pass it as a login_hint — Google then skips
// the account chooser and goes straight to that account (silently, if it's
// still the only/active Google session in the browser) instead of always
// prompting. Best-effort only: wrong on a shared device that's since switched
// accounts, but Google's chooser is still there as a fallback either way.
const LAST_EMAIL_KEY = 'propertyInventory.lastSignInEmail';
function rememberEmail(email: string | undefined | null) {
  try {
    if (email) localStorage.setItem(LAST_EMAIL_KEY, email);
  } catch {
    /* localStorage unavailable (private browsing, etc.) — just skip the hint next time */
  }
}
function getRememberedEmail(): string | undefined {
  try {
    return localStorage.getItem(LAST_EMAIL_KEY) || undefined;
  } catch {
    return undefined;
  }
}

// Best-effort parse of the "#error=...&error_description=..." (or
// "?error=...") fragment Supabase appends to the redirect URL when an OAuth
// sign-in fails — e.g. the signup-blocking trigger rejected an unapproved
// email. Clears the fragment from the URL either way so a refresh doesn't
// re-show a stale error.
function consumeOAuthErrorFromUrl(): string | null {
  const raw = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.search.slice(1);
  const params = new URLSearchParams(raw);
  const errorDescription = params.get('error_description') || params.get('error');
  if (errorDescription) {
    window.history.replaceState(null, '', window.location.pathname);
    return decodeURIComponent(errorDescription.replace(/\+/g, ' '));
  }
  return null;
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(cloudSyncEnabled);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    if (!cloudSyncEnabled) return;

    const urlError = consumeOAuthErrorFromUrl();
    if (urlError) {
      setAuthError(
        urlError.toLowerCase().includes('database error')
          ? "This Google account isn't approved for this app. Ask your admin to add it in Staff Access."
          : urlError
      );
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
      rememberEmail(data.session?.user.email);
    });
    // Keeps session state in sync across tabs and token refreshes.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      rememberEmail(newSession?.user.email);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Once signed in, double-check the account is still on the staff
  // allow-list. The saved_files RLS policies already enforce this for data
  // access, but without this check a revoked user would sign in
  // successfully and just see confusing empty lists instead of a clear
  // "you no longer have access" message.
  useEffect(() => {
    if (!session?.user.email) return;
    let cancelled = false;
    supabase
      .from('org_allowed_emails')
      .select('email')
      .ilike('email', session.user.email)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        if (!data) {
          setAuthError("Your access to this app has been removed. Ask your admin if this seems wrong.");
          supabase.auth.signOut();
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session?.user.email]);

  const clearAuthError = () => setAuthError(null);

  // Supabase performs the actual OIDC handshake with Google and issues the
  // session itself — there's no separate identity to reconcile. First-time
  // sign-in for a given Google account is what triggers the staff
  // allow-list check server-side (see the enforce_staff_allowlist trigger).
  //
  // Passes login_hint when we remember a previous email on this device, so
  // Google can skip the account chooser and go straight to that account
  // instead of always prompting — cuts this down to one click (or zero, if
  // it's the only Google session active in the browser) on repeat sign-ins.
  const signInWithGoogle = async () => {
    setAuthError(null);
    const hint = getRememberedEmail();
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
        ...(hint ? { queryParams: { login_hint: hint } } : {}),
      },
    });
  };

  // Signs out, then immediately starts a new Google sign-in with the account
  // chooser forced on, so switching accounts doesn't silently reuse
  // whichever Google session the browser already has active.
  const switchAccount = async () => {
    await supabase.auth.signOut();
    setAuthError(null);
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin, queryParams: { prompt: 'select_account' } },
    });
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        loading,
        cloudSyncEnabled,
        authError,
        clearAuthError,
        signInWithGoogle,
        switchAccount,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
