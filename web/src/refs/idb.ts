// Tiny promise wrapper over IndexedDB for reference blobs and metadata. Database "atelier":
// object store "blobs" (keys `${refId}:orig` and `${refId}:thumb`) and "refs" (one metadata
// record per reference, keyPath "id"). Fails soft: when IndexedDB is missing or errors, blobs are
// kept in memory for the session and `put` reports `false`; metadata calls report null / false.

export type BlobKind = 'orig' | 'thumb';

export interface BlobStore {
  /** Resolves true when the blob reached IndexedDB, false when it is only held in memory. */
  put(refId: string, kind: BlobKind, blob: Blob): Promise<boolean>;
  get(refId: string, kind: BlobKind): Promise<Blob | undefined>;
  /** Removes both blobs of a reference. */
  delete(refId: string): Promise<void>;
  /** All metadata records, or null when IndexedDB is unavailable (callers fall back to localStorage). */
  metaAll(): Promise<unknown[] | null>;
  /** Puts and deletes records in ONE transaction. Resolves false (nothing written) on any failure. */
  metaWrite(puts: { id: string }[], deletes: string[]): Promise<boolean>;
}

const DB_NAME = 'atelier';
const STORE = 'blobs';
const META = 'refs';
const key = (refId: string, kind: BlobKind) => `${refId}:${kind}`;

function openDb(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      if (!req.result.objectStoreNames.contains(META)) req.result.createObjectStore(META, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    req.onblocked = () => reject(new Error('IndexedDB open blocked'));
  });
}

function run<T>(db: IDBDatabase, store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest[]): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const reqs = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(reqs.map((r) => r.result as T));
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/** `factory` is injectable for tests; pass null to force the in-memory fallback. */
export function createBlobStore(factory: IDBFactory | null | undefined): BlobStore {
  const memory = new Map<string, Blob>();
  let dbPromise: Promise<IDBDatabase | null> | null = null;

  const db = (): Promise<IDBDatabase | null> => {
    if (!factory) return Promise.resolve(null);
    dbPromise ??= openDb(factory).catch(() => null);
    return dbPromise;
  };

  return {
    async put(refId, kind, blob) {
      const k = key(refId, kind);
      const d = await db();
      if (d) {
        try {
          await run(d, STORE, 'readwrite', (s) => [s.put(blob, k)]);
          memory.delete(k);
          return true;
        } catch {
          /* fall through to memory */
        }
      }
      memory.set(k, blob);
      return false;
    },
    async get(refId, kind) {
      const k = key(refId, kind);
      const mem = memory.get(k);
      if (mem) return mem;
      const d = await db();
      if (!d) return undefined;
      try {
        const [v] = await run<unknown>(d, STORE, 'readonly', (s) => [s.get(k)]);
        return v instanceof Blob ? v : undefined;
      } catch {
        return undefined;
      }
    },
    async delete(refId) {
      const keys = [key(refId, 'orig'), key(refId, 'thumb')];
      for (const k of keys) memory.delete(k);
      const d = await db();
      if (!d) return;
      try {
        await run(d, STORE, 'readwrite', (s) => keys.map((k) => s.delete(k)));
      } catch {
        /* nothing more to do */
      }
    },
    async metaAll() {
      const d = await db();
      if (!d) return null;
      try {
        const [rows] = await run<unknown[]>(d, META, 'readonly', (s) => [s.getAll()]);
        return rows;
      } catch {
        return null;
      }
    },
    async metaWrite(puts, deletes) {
      const d = await db();
      if (!d) return false;
      try {
        await run(d, META, 'readwrite', (s) => [...puts.map((p) => s.put(p)), ...deletes.map((id) => s.delete(id))]);
        return true;
      } catch {
        return false;
      }
    },
  };
}

function defaultFactory(): IDBFactory | null {
  try {
    return typeof indexedDB === 'undefined' ? null : indexedDB;
  } catch {
    return null;
  }
}

export const blobStore: BlobStore = createBlobStore(defaultFactory());
