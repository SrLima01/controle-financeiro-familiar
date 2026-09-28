import type { Account, Category, CreditCard, InstallmentGroup, Person, Transaction } from "../../domain/types/entities";
import type { EntityCollection, EntityMap, FinanceRepository, StoredEntity } from "./repository";

const DB_NAME = "controle-financeiro-familiar";
const DB_VERSION = 1;
const STORES = ["people", "categories", "accounts", "cards", "transactions", "installmentGroups"] as const;
type StoreName = typeof STORES[number];

function now(): string { return new Date().toISOString(); }

function withMetadata<T extends { id: string }>(entity: T): StoredEntity<T> {
  const timestamp = now();
  return { ...entity, createdAt: timestamp, updatedAt: timestamp, revision: 1 };
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB is not available"));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of STORES) if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open IndexedDB"));
  });
}

function runTransaction<T>(
  db: IDBDatabase,
  stores: readonly StoreName[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => Promise<T> | T
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result: T;
    let settled = false;
    tx.oncomplete = () => { settled = true; resolve(result); };
    tx.onerror = () => { if (!settled) reject(tx.error ?? new Error("IndexedDB transaction failed")); };
    tx.onabort = () => { if (!settled) reject(tx.error ?? new Error("IndexedDB transaction aborted")); };
    Promise.resolve(work(tx)).then(value => { result = value; }).catch(error => { try { tx.abort(); } catch {} if (!settled) reject(error); });
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

export class IndexedDbFinanceRepository implements FinanceRepository {
  async list<K extends keyof EntityMap>(collection: K): Promise<EntityMap[K][]> {
    const db = await openDatabase();
    try {
      return await runTransaction(db, [collection], "readonly", tx => requestResult(tx.objectStore(collection).getAll())) as EntityMap[K][];
    } finally { db.close(); }
  }

  async get<K extends keyof EntityMap>(collection: K, id: string): Promise<EntityMap[K] | undefined> {
    const db = await openDatabase();
    try {
      return await runTransaction(db, [collection], "readonly", tx => requestResult(tx.objectStore(collection).get(id))) as EntityMap[K] | undefined;
    } finally { db.close(); }
  }

  async put<K extends keyof EntityMap>(collection: K, entity: EntityMap[K]): Promise<void> {
    const db = await openDatabase();
    try {
      await runTransaction(db, [collection], "readwrite", async tx => {
        const store = tx.objectStore(collection);
        const previous = await requestResult(store.get(entity.id)) as StoredEntity<EntityMap[K]> | undefined;
        const timestamp = now();
        const record: StoredEntity<EntityMap[K]> = {
          ...entity,
          createdAt: previous?.createdAt ?? timestamp,
          updatedAt: timestamp,
          revision: (previous?.revision ?? 0) + 1
        };
        store.put(record);
      });
    } finally { db.close(); }
  }

  async putMany<K extends keyof EntityMap>(collection: K, entities: EntityMap[K][]): Promise<void> {
    const db = await openDatabase();
    try {
      await runTransaction(db, [collection], "readwrite", tx => {
        const store = tx.objectStore(collection);
        const timestamp = now();
        for (const entity of entities) store.put({ ...entity, createdAt: timestamp, updatedAt: timestamp, revision: 1 });
      });
    } finally { db.close(); }
  }

  async replaceAll(data: EntityCollection): Promise<void> {
    const db = await openDatabase();
    try {
      await runTransaction(db, STORES, "readwrite", tx => {
        for (const storeName of STORES) {
          const store = tx.objectStore(storeName);
          store.clear();
          const entities = data[storeName] as Array<{ id: string }>;
          const timestamp = now();
          for (const entity of entities) store.put({ ...entity, createdAt: timestamp, updatedAt: timestamp, revision: 1 });
        }
      });
    } finally { db.close(); }
  }

  async clear(): Promise<void> {
    const db = await openDatabase();
    try {
      await runTransaction(db, STORES, "readwrite", tx => { for (const name of STORES) tx.objectStore(name).clear(); });
    } finally { db.close(); }
  }
}

export const entityCollections: StoreName[] = [...STORES];
export type DomainEntity = Person | Category | Account | CreditCard | Transaction | InstallmentGroup;