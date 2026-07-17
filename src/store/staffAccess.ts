// Manages the org_allowed_emails allow-list — the gate that decides who's
// allowed to create an account at all (enforced server-side by a Postgres
// trigger on auth.users; see the "enforce_staff_allowlist" migration).
// Only admins can add/remove rows here — RLS enforces that too, this module
// just wraps the queries the UI needs.

import { supabase } from '../lib/supabaseClient';

export interface StaffEntry {
  email: string;
  isAdmin: boolean;
  addedAt: string;
}

export async function listStaff(): Promise<StaffEntry[]> {
  const { data, error } = await supabase
    .from('org_allowed_emails')
    .select('email, is_admin, added_at')
    .order('added_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(r => ({ email: r.email, isAdmin: r.is_admin, addedAt: r.added_at }));
}

// Returns whether the given email is an admin — used to decide whether to
// show the Staff Access panel at all. Returns false (rather than throwing)
// if the row can't be read, so a query hiccup just hides the panel.
export async function isStaffAdmin(email: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('org_allowed_emails')
    .select('is_admin')
    .ilike('email', email)
    .maybeSingle();
  if (error || !data) return false;
  return data.is_admin;
}

export async function addStaff(email: string, addedBy: string): Promise<void> {
  const { error } = await supabase
    .from('org_allowed_emails')
    .insert({ email: email.trim().toLowerCase(), added_by: addedBy });
  if (error) throw error;
}

export async function removeStaff(email: string): Promise<void> {
  const { error } = await supabase.from('org_allowed_emails').delete().eq('email', email);
  if (error) throw error;
}
