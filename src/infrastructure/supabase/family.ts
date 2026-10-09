import { supabase } from "./client";

export async function createFamily(name: string): Promise<string> {
  const { data, error } = await supabase.rpc("create_family", { p_name: name });
  if (error) throw error;
  return data as string;
}

export async function joinFamily(inviteCode: string): Promise<string> {
  const { data, error } = await supabase.rpc("join_family", { p_invite_code: inviteCode });
  if (error) throw error;
  return data as string;
}

export type Family = {
  id: string;
  name: string;
  invite_code: string;
  created_by: string;
  created_at: string;
};

export async function listMyFamilies(): Promise<Family[]> {
  const { data, error } = await supabase
    .from("families")
    .select("id,name,invite_code,created_by,created_at")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data as Family[];
}


/**
 * Creates the default individual workspace for a new account.
 * If the account already belongs to a workspace, the database returns one
 * existing membership instead of creating a duplicate.
 */
export async function ensurePersonalSpace(): Promise<string> {
  const { data, error } = await supabase.rpc("ensure_personal_space");
  if (error) throw error;
  return data as string;
}
