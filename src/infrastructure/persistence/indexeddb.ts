import type { Account, Category, CreditCard, InstallmentGroup, Person, Pot, PotMovement, RecurringRule, Transaction, Budget } from "../../domain/types/entities";
import type { EntityCollection, EntityMap, FinanceRepository, StoredEntity } from "./repository";

const DB_NAME_PREFIX = "controle-financeiro-familiar";
const DB_VERSION = 4;
const STORES = ["people", "categories", "accounts", "cards", "transactions", "installmentGroups", "recurringRules", "pots", "potMovements", "budgets"] as const;
const META_STORE = "syncMeta" as const;
type StoreName = typeof STORES[number];
type SyncStoreName = StoreName | typeof META_STORE;
export type LocalSyncMetadata = { remoteVersion: number; dirty: boolean };

function now(): string {
  return new Date().toISOString();
}

function openDatabase(dbName: string): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB is not available"));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of STORES) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open IndexedDB"));
  });
}

/**
 * Important IndexedDB rule: do not await an IDB request inside a transaction.
 * A transaction can become inactive between event-loop turns and commit before
 * the awaited continuation resumes. Work therefore schedules all requests from
 * IDB callbacks and resolves the outer promise only on transaction completion.
 */
function runTransaction<T>(
  db: IDBDatabase,
  stores: readonly SyncStoreName[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction, setResult: (value: T) => void) => void
): Promise<T> {
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction(stores, mode);
    } catch (error) {
      reject(error);
      return;
    }

    let result!: T;
    let failed = false;

    const fail = (error: unknown) => {
      if (failed) return;
      failed = true;
      try { tx.abort(); } catch {}
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    tx.oncomplete = () => {
      if (!failed) resolve(result);
    };
    tx.onerror = () => fail(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => {
      if (!failed) {
        failed = true;
        reject(tx.error ?? new Error("IndexedDB transaction aborted"));
      }
    };

    try {
      work(tx, value => { result = value; });
    } catch (error) {
      fail(error);
    }
  });
}

function requestError<T>(request: IDBRequest<T>, fail: (error: unknown) => void): void {
  request.onerror = () => fail(request.error ?? new Error("IndexedDB request failed"));
}

export class IndexedDbFinanceRepository implements FinanceRepository {
  private readonly dbName: string;

  constructor(familyId: string) {
    if (!familyId.trim()) throw new Error("familyId é obrigatório para o armazenamento local.");
    this.dbName = `${DB_NAME_PREFIX}-${familyId}`;
  }

  async list<K extends keyof EntityMap>(collection: K): Promise<EntityMap[K][]> {
    const db = await openDatabase(this.dbName);
    try {
      return await runTransaction(db, [collection], "readonly", (tx, setResult) => {
        const request = tx.objectStore(collection).getAll();
        request.onsuccess = () => setResult(request.result as EntityMap[K][]);
        requestError(request, error => { try { tx.abort(); } catch {} throw error; });
      });
    } finally {
      db.close();
    }
  }

  async get<K extends keyof EntityMap>(collection: K, id: string): Promise<EntityMap[K] | undefined> {
    const db = await openDatabase(this.dbName);
    try {
      return await runTransaction(db, [collection], "readonly", (tx, setResult) => {
        const request = tx.objectStore(collection).get(id);
        request.onsuccess = () => setResult(request.result as EntityMap[K] | undefined);
        requestError(request, error => { try { tx.abort(); } catch {} throw error; });
      });
    } finally {
      db.close();
    }
  }

  async put<K extends keyof EntityMap>(collection: K, entity: EntityMap[K]): Promise<void> {
    const db = await openDatabase(this.dbName);
    try {
      await runTransaction(db, [collection], "readwrite", (tx) => {
        const store = tx.objectStore(collection);
        const request = store.get(entity.id);
        request.onsuccess = () => {
          const previous = request.result as StoredEntity<EntityMap[K]> | undefined;
          const timestamp = now();
          const record = {
            ...entity,
            createdAt: previous?.createdAt ?? timestamp,
            updatedAt: timestamp,
            revision: (previous?.revision ?? 0) + 1
          };
          store.put(record);
        };
        requestError(request, error => { try { tx.abort(); } catch {} throw error; });
      });
    } finally {
      db.close();
    }
  }

  async putMany<K extends keyof EntityMap>(collection: K, entities: EntityMap[K][]): Promise<void> {
    const db = await openDatabase(this.dbName);
    try {
      await runTransaction(db, [collection], "readwrite", (tx) => {
        const store = tx.objectStore(collection);
        const timestamp = now();
        for (const entity of entities) {
          store.put({ ...entity, createdAt: timestamp, updatedAt: timestamp, revision: 1 });
        }
      });
    } finally {
      db.close();
    }
  }

  async replaceAll(data: EntityCollection): Promise<void> {
    const db = await openDatabase(this.dbName);
    try {
      await runTransaction(db, STORES, "readwrite", (tx) => {
        for (const storeName of STORES) {
          const store = tx.objectStore(storeName);
          store.clear();
          const entities = data[storeName] as Array<{ id: string }>;
          const timestamp = now();
          for (const entity of entities) {
            store.put({ ...entity, createdAt: timestamp, updatedAt: timestamp, revision: 1 });
          }
        }
      });
    } finally {
      db.close();
    }
  }

  async getSyncMetadata(): Promise<LocalSyncMetadata> {
    const db = await openDatabase(this.dbName);
    try {
      return await runTransaction(db, [META_STORE], "readonly", (tx, setResult) => {
        const request = tx.objectStore(META_STORE).get("sync");
        request.onsuccess = () => {
          const value = request.result as { id: string; remoteVersion: number; dirty: boolean } | undefined;
          setResult({ remoteVersion: value?.remoteVersion ?? 0, dirty: value?.dirty ?? false });
        };
        requestError(request, error => { try { tx.abort(); } catch {} throw error; });
      });
    } finally {
      db.close();
    }
  }

  async setSyncMetadata(metadata: LocalSyncMetadata): Promise<void> {
    const db = await openDatabase(this.dbName);
    try {
      await runTransaction(db, [META_STORE], "readwrite", (tx) => {
        tx.objectStore(META_STORE).put({ id: "sync", ...metadata, updatedAt: now() });
      });
    } finally {
      db.close();
    }
  }

  async clear(): Promise<void> {
    const db = await openDatabase(this.dbName);
    try {
      await runTransaction(db, STORES, "readwrite", (tx) => {
        for (const name of STORES) tx.objectStore(name).clear();
      });
    } finally {
      db.close();
    }
  }
}

export const entityCollections: StoreName[] = [...STORES];
export type DomainEntity = Person | Category | Account | CreditCard | Transaction | InstallmentGroup | RecurringRule | Pot | PotMovement | Budget;
