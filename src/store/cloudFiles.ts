// Cloud-backed mirror of fileHistory.ts (IndexedDB), so "Saved Files" can be
// reached from any device once the user is signed in. Same shape/semantics as
// the local library — one row per filename, latest save wins. Each user's
// files are private to them: RLS restricts every query here to rows where
// user_id matches the signed-in user, so no manual filtering is needed in
// these queries — signing in just gates who can create an account at all
// (via the org_allowed_emails allow-list), not who can see whose data.

import { supabase } from '../lib/supabaseClient';

export interface CloudFileEntry {
  id: string;
  filename: string;
  savedAt: string;
  json: string;
  userId: string;
  ownerEmail: string | null;
}

export async function listCloudFiles(): Promise<CloudFileEntry[]> {
  const { data, error } = await supabase
    .from('saved_files')
    .select('id, filename, json, updated_at, user_id, owner_email')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(r => ({
    id: r.id, filename: r.filename, json: r.json, savedAt: r.updated_at,
    userId: r.user_id, ownerEmail: r.owner_email,
  }));
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
    .select('id')
    .ilike('filename', filename)
    .maybeSingle();
  if (findErr) throw findErr;

  if (existing) {
    const { error } = await supabase.from('saved_files').update({ json }).eq('id', existing.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('saved_files').insert({ user_id: user.id, filename, json, owner_email: user.email });
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
