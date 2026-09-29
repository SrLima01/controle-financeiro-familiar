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

const COLLECTIONS: (keyof EntityMap)[] = [
  "people",
  "categories",
  "accounts",
  "cards",
  "transactions",
  "installmentGroups"
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function assertArray(value: unknown, name: string): asserts value is unknown[] {
  if (!Array.isArray(value)) throw new Error(`Backup field ${name} must be an array`);
}

function assertUniqueIds(items: unknown[], name: string): void {
  const ids = new Set<string>();
  for (const item of items) {
    if (!isRecord(item) || typeof item.id !== "string" || !item.id) {
      throw new Error(`Invalid id in ${name}`);
    }
    if (ids.has(item.id)) throw new Error(`Duplicate id in ${name}: ${item.id}`);
    ids.add(item.id);
  }
}

export function validateBackup(input: unknown): FinanceBackup {
  if (!isRecord(input)) throw new Error("Backup must be a JSON object");
  if (input.schemaVersion !== BACKUP_SCHEMA_VERSION) throw new Error("Unsupported backup schema version");
  if (typeof input.appVersion !== "string" || typeof input.exportedAt !== "string") {
    throw new Error("Invalid backup metadata");
  }
  if (!isRecord(input.data)) throw new Error("Backup data is required");

  for (const collection of COLLECTIONS) {
    assertArray(input.data[collection], collection);
    assertUniqueIds(input.data[collection], collection);
  }

  const data = input.data as EntityCollection;
  const accountIds = new Set(data.accounts.map(a => a.id));
  const cardIds = new Set(data.cards.map(c => c.id));
  const personIds = new Set(data.people.map(p => p.id));
  const categoryIds = new Set(data.categories.map(c => c.id));
  const installmentIds = new Set(data.installmentGroups.map(g => g.id));
  const allowedAccountTypes = new Set(["CHECKING", "SAVINGS", "DIGITAL", "CASH", "INVESTMENT"]);
  const allowedTransactionTypes = new Set(["INCOME", "EXPENSE", "TRANSFER", "CARD_PAYMENT"]);
  const allowedStatuses = new Set(["PENDING", "PAID", "RECEIVED", "PLANNED", "CANCELLED"]);

  for (const person of data.people) {
    if (typeof person.name !== "string" || typeof person.active !== "boolean") {
      throw new Error("Invalid person " + person.id);
    }
  }

  for (const category of data.categories) {
    if (
      typeof category.name !== "string" ||
      typeof category.active !== "boolean" ||
      !["INCOME", "EXPENSE"].includes(category.kind)
    ) {
      throw new Error("Invalid category " + category.id);
    }
  }

  for (const account of data.accounts as Account[]) {
    if (
      typeof account.name !== "string" ||
      typeof account.active !== "boolean" ||
      !allowedAccountTypes.has(account.type)
    ) {
      throw new Error("Invalid account " + account.id);
    }
    if (!Number.isSafeInteger(account.openingBalanceCents)) {
      throw new Error("Invalid opening balance for account " + account.id);
    }
  }

  for (const card of data.cards as CreditCard[]) {
    if (
      typeof card.name !== "string" ||
      typeof card.active !== "boolean" ||
      !accountIds.has(card.accountId)
    ) {
      throw new Error("Invalid card " + card.id);
    }
    if (!Number.isSafeInteger(card.creditLimitCents) || card.creditLimitCents < 0) {
      throw new Error("Invalid card limit for " + card.id);
    }
    if (
      !Number.isInteger(card.closingDay) ||
      card.closingDay < 1 ||
      card.closingDay > 31 ||
      !Number.isInteger(card.dueDay) ||
      card.dueDay < 1 ||
      card.dueDay > 31
    ) {
      throw new Error("Invalid card dates for " + card.id);
    }
  }

  for (const group of data.installmentGroups) {
    if (
      typeof group.description !== "string" ||
      !Number.isSafeInteger(group.totalAmountCents) ||
      group.totalAmountCents < 0 ||
      !Number.isInteger(group.installmentCount) ||
      group.installmentCount < 1 ||
      !Array.isArray(group.transactionIds)
    ) {
      throw new Error("Invalid installment group " + group.id);
    }
  }

  for (const tx of data.transactions as Transaction[]) {
    if (
      typeof tx.description !== "string" ||
      !allowedTransactionTypes.has(tx.type) ||
      !allowedStatuses.has(tx.status)
    ) {
      throw new Error("Invalid transaction " + tx.id);
    }
    if (tx.personId && !personIds.has(tx.personId)) {
      throw new Error("Transaction " + tx.id + " references an unknown person");
    }
    if (tx.categoryId && !categoryIds.has(tx.categoryId)) {
      throw new Error("Transaction " + tx.id + " references an unknown category");
    }
    if (tx.creditCardId && !cardIds.has(tx.creditCardId)) {
      throw new Error("Transaction " + tx.id + " references an unknown card");
    }
    if (tx.installmentGroupId && !installmentIds.has(tx.installmentGroupId)) {
      throw new Error("Transaction " + tx.id + " references an unknown installment group");
    }
  }

  validateAllTransactions({
    accounts: data.accounts,
    cards: data.cards,
    transactions: data.transactions
  });

  const transactionIds = new Set(data.transactions.map(tx => tx.id));
  for (const group of data.installmentGroups) {
    for (const txId of group.transactionIds) {
      if (!transactionIds.has(txId)) {
        throw new Error("Installment group " + group.id + " references an unknown transaction");
      }
    }
  }

  return input as FinanceBackup;
}

export function serializeBackup(data: EntityCollection, appVersion = "0.1.0"): string {
  const backup: FinanceBackup = {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    appVersion,
    exportedAt: new Date().toISOString(),
    data
  };
  return JSON.stringify(backup, null, 2);
}

export function parseBackup(json: string): FinanceBackup {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Invalid JSON backup");
  }
  return validateBackup(parsed);
}

export function emptyEntityCollection(): EntityCollection {
  return {
    people: [],
    categories: [],
    accounts: [],
    cards: [],
    transactions: [],
    installmentGroups: []
  };
}
