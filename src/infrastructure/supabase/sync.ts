import type { EntityCollection } from "../persistence/repository";
import { emptyEntityCollection, validateBackup } from "../persistence/backup";
import { supabase } from "./client";

export type RemoteFinanceState = {
  familyId: string;
  schemaVersion: number;
  state: EntityCollection;
  version: number;
  updatedAt: string;
  updatedBy: string | null;
};

export class SyncConflictError extends Error {
  constructor(message = "O estado remoto mudou antes do salvamento.") {
    super(message);
    this.name = "SyncConflictError";
  }
}

function validateRemoteState(value: unknown, schemaVersion: number): EntityCollection {
  const candidate = { schemaVersion, appVersion: "remote", exportedAt: new Date(0).toISOString(), data: value };
  return validateBackup(candidate).data;
}

export async function pullFinanceState(familyId: string): Promise<RemoteFinanceState | null> {
  const { data, error } = await supabase
    .from("finance_state")
    .select("family_id,schema_version,state,version,updated_at,updated_by")
    .eq("family_id", familyId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  const state = validateRemoteState(data.state, Number(data.schema_version));
  return {
    familyId: data.family_id,
    schemaVersion: Number(data.schema_version),
    state,
    version: Number(data.version),
    updatedAt: data.updated_at,
    updatedBy: data.updated_by
  };
}

export async function pushFinanceState(
  familyId: string,
  state: EntityCollection,
  expectedVersion: number
): Promise<number> {
  validateRemoteState(state, 1);
  const { data, error } = await supabase.rpc("save_finance_state", {
    p_family_id: familyId,
    p_state: state,
    p_expected_version: expectedVersion
  });

  if (error) {
    if (error.message.includes("sync_conflict")) throw new SyncConflictError();
    throw error;
  }

  return Number(data);
}

export { emptyEntityCollection };