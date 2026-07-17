import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

if (!url || !publishableKey) {
  // Cloud sync is optional — the app still works fully offline via local
  // "Saved Files" (IndexedDB) if these aren't configured. Warn rather than throw
  // so a missing .env doesn't break the rest of the app.
  console.warn('Supabase env vars missing — cloud sync (cross-device Saved Files) is disabled.');
}

export const supabase = createClient(url || 'https://placeholder.supabase.co', publishableKey || 'placeholder');

export const cloudSyncEnabled = Boolean(url && publishableKey);
