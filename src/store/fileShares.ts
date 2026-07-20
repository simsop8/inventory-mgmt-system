// Manages saved_files_shares — whole-library, full-edit-access sharing of a
// user's Saved Files with another existing (already-approved) user. Sharing
// with someone grants them the same view/edit/delete rights the owner has
// over the owner's saved files (enforced by saved_files' RLS policies, not
// by this module) — removing the share here cuts that access off immediately.

import { supabase } from '../lib/supabaseClient';

export interface ShareEntry {
  id: string;
  sharedWithEmail: string;
  createdAt: string;
}

// Shares I (the signed-in user) have granted to others. Explicitly filtered to rows I
// own — RLS on this table also lets a recipient read the row someone else created to
// share with them (needed so recipients can actually access the shared files), so
// without this filter a signed-in recipient would also see their own email show up
// here as if they'd shared with themselves.
export async function listMyShares(): Promise<ShareEntry[]> {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr) throw userErr;
  const user = userData.user;
  if (!user) throw new Error('Not signed in');

  const { data, error } = await supabase
    .from('saved_files_shares')
    .select('id, shared_with_email, created_at')
    .eq('owner_user_id', user.id)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(r => ({ id: r.id, sharedWithEmail: r.shared_with_email, createdAt: r.created_at }));
}

export async function addShare(sharedWithEmail: string): Promise<void> {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr) throw userErr;
  const user = userData.user;
  if (!user?.email) throw new Error('Not signed in');
  const { error } = await supabase
    .from('saved_files_shares')
    .insert({ owner_user_id: user.id, owner_email: user.email, shared_with_email: sharedWithEmail.trim().toLowerCase() });
  if (error) throw error;
}

export async function removeShare(id: string): Promise<void> {
  const { error } = await supabase.from('saved_files_shares').delete().eq('id', id);
  if (error) throw error;
}
