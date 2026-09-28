import type { EntityCollection, EntityMap } from "./repository";
import type { Account, CreditCard, Transaction } from "../../domain/types/entities";
import { validateAllTransactions } from "../../domain/transactions/financial-engine";

export const BACKUP_SCHEMA_VERSION = 1;
export type FinanceBackup = {
  schemaVersion: number;
  appVersion: string;
  exportedAt: string;
  data: EntityCollection;
};

const COLLECTIONS: (keyof EntityMap)[] = ["people","categories","accounts","cards","transactions","installmentGroups"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function assertArray(value: unknown, name: string): asserts value is unknown[] {
  if (!Array.isArray(value)) throw new Error(`Backup field ${name} must be an array`);
}

function assertUniqueIds(items: unknown[], name: string): void {
  const ids = new Set<string>();
  for (const item of items) {
    if (!isRecord(item) || typeof item.id !== "string" || !item.id) throw new Error(`Invalid id in ${name}`);
    if (ids.has(item.id)) throw new Error(`Duplicate id in ${name}: ${item.id}`);
    ids.add(item.id);
  }
}

export function validateBackup(input: unknown): FinanceBackup {
  if (!isRecord(input)) throw new Error("Backup must be a JSON object");
  if (input.schemaVersion !== BACKUP_SCHEMA_VERSION) throw new Error("Unsupported backup schema version");
  if (typeof input.appVersion !== "string" || typeof input.exportedAt !== "string") throw new Error("Invalid backup metadata");
  if (!isRecord(input.data)) throw new Error("Backup data is required");

  for (const collection of COLLECTIONS) {
    assertArray(input.data[collection], collection);
    assertUniqueIds(input.data[collection], collection);
  }

  const data = input.data as EntityCollection;
  const accountIds = new Set(data.accounts.map(a => a.id));
  const cardIds = new Set(data.cards.map(c => c.id));
  for (const account of data.accounts as Account[]) {
    if (!Number.isSafeInteger(account.openingBalanceCents)) throw new Error(`Invalid opening balance for account ${account.id}`);
  }
  for (const card of data.cards as CreditCard[]) {
    if (!accountIds.has(card.accountId)) throw new Error(`Card ${card.id} references an unknown account`);
    if (!Number.isSafeInteger(card.creditLimitCents) || card.creditLimitCents < 0) throw new Error(`Invalid card limit for ${card.id}`);
  }
  validateAllTransactions({ accounts: data.accounts, cards: data.cards, transactions: data.transactions });
  for (const tx of data.transactions as Transaction[]) {
    if (tx.creditCardId && !cardIds.has(tx.creditCardId)) throw new Error(`Transaction ${tx.id} references an unknown card`);
    if (tx.installmentGroupId && !data.installmentGroups.some(g => g.id === tx.installmentGroupId)) throw new Error(`Transaction ${tx.id} references an unknown installment group`);
  }
  return data;
}

export function serializeBackup(data: EntityCollection, appVersion = "0.1.0"): string {
  const backup: FinanceBackup = { schemaVersion: BACKUP_SCHEMA_VERSION, appVersion, exportedAt: new Date().toISOString(), data };
  return JSON.stringify(backup, null, 2);
}

export function parseBackup(json: string): FinanceBackup {
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { throw new Error("Invalid JSON backup"); }
  return validateBackup(parsed);
}

export function emptyEntityCollection(): EntityCollection {
  return { people: [], categories: [], accounts: [], cards: [], transactions: [], installmentGroups: [] };
}