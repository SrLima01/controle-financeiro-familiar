import type { EntityCollection, EntityMap } from "./repository";
import type { Account, CreditCard, Pot, PotMovement, RecurringRule, Transaction, Budget } from "../../domain/types/entities";
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
  "installmentGroups",
  "recurringRules",
  "pots",
  "potMovements",
  "budgets"
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
  // Backward compatibility: states created before Fase 10 do not have this collection.
  if (!("recurringRules" in input.data)) input.data.recurringRules = [];
  if (!("pots" in input.data)) input.data.pots = [];
  if (!("potMovements" in input.data)) input.data.potMovements = [];
  if (!("budgets" in input.data)) input.data.budgets = [];

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

  const activePersonNames = new Set<string>();
  for (const person of data.people) {
    if (typeof person.name !== "string" || !person.name.trim() || person.name.trim().length > 80 || typeof person.active !== "boolean") {
      throw new Error("Invalid person " + person.id);
    }
    if (person.active) {
      const key = person.name.trim().toLocaleLowerCase("pt-BR");
      if (activePersonNames.has(key)) throw new Error("Duplicate active person name: " + person.id);
      activePersonNames.add(key);
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

  for (const rule of data.recurringRules as RecurringRule[]) {
    if (
      typeof rule.description !== "string" ||
      !Number.isSafeInteger(rule.amountCents) ||
      rule.amountCents < 0 ||
      !["INCOME", "EXPENSE"].includes(rule.type) ||
      !["PENDING", "PAID", "RECEIVED", "PLANNED"].includes(rule.status) ||
      !["WEEKLY", "BIWEEKLY", "MONTHLY", "BIMONTHLY", "QUARTERLY", "SEMIANNUAL", "ANNUAL"].includes(rule.frequency) ||
      typeof rule.startDate !== "string" ||
      !Array.isArray(rule.transactionIds) ||
      typeof rule.active !== "boolean"
    ) throw new Error("Invalid recurring rule " + rule.id);
    if (rule.accountId && !accountIds.has(rule.accountId)) throw new Error("Recurring rule references an unknown account");
    if (rule.creditCardId && !cardIds.has(rule.creditCardId)) throw new Error("Recurring rule references an unknown card");
    if (rule.categoryId && !categoryIds.has(rule.categoryId)) throw new Error("Recurring rule references an unknown category");
    if (rule.personId && !personIds.has(rule.personId)) throw new Error("Recurring rule references an unknown person");
  }

  for (const pot of data.pots as Pot[]) {
    if (typeof pot.name !== "string" || !Number.isSafeInteger(pot.targetCents) || pot.targetCents < 0 || typeof pot.active !== "boolean") {
      throw new Error("Invalid pot " + pot.id);
    }
  }

  const potIds = new Set(data.pots.map(p => p.id));
  for (const movement of data.potMovements as PotMovement[]) {
    if (
      !potIds.has(movement.potId) ||
      !["DEPOSIT", "WITHDRAWAL"].includes(movement.type) ||
      !Number.isSafeInteger(movement.amountCents) ||
      movement.amountCents <= 0 ||
      typeof movement.date !== "string" ||
      typeof movement.description !== "string"
    ) throw new Error("Invalid pot movement " + movement.id);
  }

  const budgetCategoryIds = new Set(data.categories.map(c => c.id));
  for (const budget of data.budgets as Budget[]) {
    if (
      typeof budget.month !== "string" || !/^\d{4}-\d{2}$/.test(budget.month) ||
      !budgetCategoryIds.has(budget.categoryId) ||
      !Number.isSafeInteger(budget.limitCents) || budget.limitCents < 0 ||
      typeof budget.active !== "boolean"
    ) throw new Error("Invalid budget " + budget.id);
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
    if (group.transactionIds.length !== group.installmentCount) {
      throw new Error("Installment group " + group.id + " has an inconsistent transaction count");
    }
    const groupTransactionIds = new Set(group.transactionIds);
    if (groupTransactionIds.size !== group.transactionIds.length) {
      throw new Error("Installment group " + group.id + " contains duplicate transaction ids");
    }
    for (const txId of group.transactionIds) {
      if (!transactionIds.has(txId)) {
        throw new Error("Installment group " + group.id + " references an unknown transaction");
      }
      const tx = data.transactions.find(item => item.id === txId);
      if (!tx || tx.installmentGroupId !== group.id) {
        throw new Error("Installment group " + group.id + " has an inconsistent transaction link");
      }
    }
  }

  for (const tx of data.transactions) {
    if (tx.installmentGroupId) {
      const group = data.installmentGroups.find(item => item.id === tx.installmentGroupId);
      if (!group || !group.transactionIds.includes(tx.id)) {
        throw new Error("Transaction " + tx.id + " has an inconsistent installment link");
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
    installmentGroups: [],
    recurringRules: [],
    pots: [],
    potMovements: [],
    budgets: []
  };
}
