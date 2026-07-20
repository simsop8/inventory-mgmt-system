// Cloud-backed mirror of fileHistory.ts (IndexedDB), so "Saved Files" can be
// reached from any device once the user is signed in. Same shape/semantics as
// the local library — one row per filename, latest save wins. Each user's
// files are private to them: RLS restricts every query here to rows where
// user_id matches the signed-in user, so no manual filtering is needed in
// these queries — signing in just gates who can create an account at all
// (via the org_allowed_emails allow-list), not who can see whose data.

import { supabase } from '../lib/supabaseClient';
import { dehydrateJson, hydrateJson } from './photoStorage';

// Deliberately excludes `json` — each row's json column holds the entire property
// profile including every embedded photo (often several MB, sometimes 5-9MB+ for a
// condition-report-heavy property). The Saved Files list only needs filename/timestamp/
// ownership to render, so fetching it for every row here (as this used to do) meant every
// list refresh silently downloaded the full content of every saved file — the actual
// cause of the app feeling slow, and a fast way to burn through the free tier's egress
// allowance. Use getCloudFileJson() to fetch one specific file's content on demand
// (Load/Download/Backup), only when it's actually needed.
export interface CloudFileEntry {
  id: string;
  filename: string;
  savedAt: string;
  userId: string;
  ownerEmail: string | null;
}

export async function listCloudFiles(): Promise<CloudFileEntry[]> {
  const { data, error } = await supabase
    .from('saved_files')
    .select('id, filename, updated_at, user_id, owner_email')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(r => ({
    id: r.id, filename: r.filename, savedAt: r.updated_at,
    userId: r.user_id, ownerEmail: r.owner_email,
  }));
}

// Fetches one file's full content — the counterpart to the lean listCloudFiles() above.
// Rehydrates any storage: photo references back into real dataURLs before returning, so
// callers (importProfile, addSavedFile, the backup/download flows) always get a fully
// self-contained profile exactly as if photos had never left the JSON at all.
export async function getCloudFileJson(id: string): Promise<string> {
  const { data, error } = await supabase.from('saved_files').select('json').eq('id', id).single();
  if (error) throw error;
  return hydrateJson(data.json);
}

// Overwrites in place if a file with the same name (case-insensitive) already
// exists and is visible to this user (their own, or shared with them),
// otherwise inserts a new row owned by this user. Editing a file shared with
// you (full-edit-access sharing) goes through this same update path — RLS is
// what actually allows/denies it, not anything here.
export async function upsertCloudFile(filename: string, json: string): Promise<void> {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr) throw userErr;
  const user = userData.user;
  if (!user?.email) throw new Error('Not signed in');

  const { data: existing, error: findErr } = await supabase
    .from('saved_files')
    .select('id, user_id')
    .ilike('filename', filename)
    .maybeSingle();
  if (findErr) throw findErr;

  // Photos upload under whichever user actually owns the row — the file's original
  // owner (matters for a file shared with you), not necessarily whoever is pushing this
  // particular sync — so the Storage RLS policies resolve the same way the row's own
  // RLS does. Falls back to writing the plain inline json if the photo upload step fails
  // (offline, storage misconfigured, etc.) rather than losing the save entirely — it'll
  // dehydrate again on the next successful sync.
  const ownerUserId = existing?.user_id ?? user.id;
  let payload = json;
  try {
    payload = await dehydrateJson(json, ownerUserId);
  } catch {
    /* keep the inline json as a fallback */
  }

  if (existing) {
    const { error } = await supabase.from('saved_files').update({ json: payload }).eq('id', existing.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('saved_files').insert({ user_id: user.id, filename, json: payload, owner_email: user.email });
    if (error) throw error;
  }
}

export async function deleteCloudFile(id: string): Promise<void> {
  const { error } = await supabase.from('saved_files').delete().eq('id', id);
  if (error) throw error;
}

// Renames an entry in place — same row, same content, just a new filename.
// RLS decides whether this is allowed (your own file, or one shared with you
// with full edit access) same as any other update to this table.
export async function renameCloudFile(id: string, newFilename: string): Promise<void> {
  const { error } = await supabase.from('saved_files').update({ filename: newFilename }).eq('id', id);
  if (error) throw error;
}
