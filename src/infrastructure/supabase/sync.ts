import type { EntityCollection } from "../persistence/repository";
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

function isEntityCollection(value: unknown): value is EntityCollection {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  return ["people", "categories", "accounts", "cards", "transactions", "installmentGroups"]
    .every(key => Array.isArray(data[key]));
}

export async function pullFinanceState(familyId: string): Promise<RemoteFinanceState | null> {
  const { data, error } = await supabase
    .from("finance_state")
    .select("family_id,schema_version,state,version,updated_at,updated_by")
    .eq("family_id", familyId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  if (!isEntityCollection(data.state)) throw new Error("Estado financeiro remoto inválido.");
  return {
    familyId: data.family_id,
    schemaVersion: data.schema_version,
    state: data.state,
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
