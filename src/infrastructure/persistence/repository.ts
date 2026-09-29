import type { Account, Category, CreditCard, InstallmentGroup, Person, RecurringRule, Transaction } from "../../domain/types/entities";

export type EntityMap = {
  people: Person;
  categories: Category;
  accounts: Account;
  cards: CreditCard;
  transactions: Transaction;
  installmentGroups: InstallmentGroup;
  recurringRules: RecurringRule;
};

export type EntityCollection = { [K in keyof EntityMap]: EntityMap[K][] };

export type SyncMetadata = {
  id: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  archivedAt?: string;
  deletedAt?: string;
};

export type StoredEntity<T> = T & SyncMetadata;

export interface FinanceRepository {
  list<K extends keyof EntityMap>(collection: K): Promise<EntityMap[K][]>;
  get<K extends keyof EntityMap>(collection: K, id: string): Promise<EntityMap[K] | undefined>;
  put<K extends keyof EntityMap>(collection: K, entity: EntityMap[K]): Promise<void>;
  putMany<K extends keyof EntityMap>(collection: K, entities: EntityMap[K][]): Promise<void>;
  replaceAll(data: EntityCollection): Promise<void>;
  clear(): Promise<void>;
}
