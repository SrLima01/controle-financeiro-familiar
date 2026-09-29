import type { EntityCollection } from "../persistence/repository";
import { pullFinanceState, pushFinanceState, SyncConflictError } from "./sync";

export type SyncResult =
  | { kind: "pulled"; version: number; state: EntityCollection | null }
  | { kind: "pushed"; version: number }
  | { kind: "conflict"; remoteVersion: number };

export async function pullForLocalFirst(familyId: string): Promise<SyncResult> {
  const remote = await pullFinanceState(familyId);
  return {
    kind: "pulled",
    version: remote?.version ?? 0,
    state: remote?.state ?? null
  };
}

export async function pushFromLocalFirst(
  familyId: string,
  state: EntityCollection,
  knownRemoteVersion: number
): Promise<SyncResult> {
  try {
    const version = await pushFinanceState(familyId, state, knownRemoteVersion);
    return { kind: "pushed", version };
  } catch (error) {
    if (!(error instanceof SyncConflictError)) throw error;
    const remote = await pullFinanceState(familyId);
    return { kind: "conflict", remoteVersion: remote?.version ?? 0 };
  }
}
