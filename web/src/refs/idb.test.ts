import { describe, expect, it } from 'vitest';
import { createBlobStore } from './idb';

/** Minimal in-memory IDBFactory: just enough for open / transaction / put / get / delete. */
function fakeFactory(opts: { failOpen?: boolean; failPut?: boolean } = {}) {
  const stores: Record<string, Map<string, unknown>> = { blobs: new Map(), refs: new Map() };
  const data = stores.blobs;
  const later = (fn: () => void) => queueMicrotask(fn);
  const request = (run: () => unknown, onDone?: () => void, onFail?: () => void) => {
    const req: Record<string, unknown> = { result: undefined };
    later(() => {
      try {
        req.result = run();
        (req.onsuccess as (() => void) | undefined)?.();
        onDone?.();
      } catch (e) {
        req.error = e;
        (req.onerror as (() => void) | undefined)?.();
        onFail?.();
      }
    });
    return req;
  };
  const db = {
    objectStoreNames: { contains: () => true },
    createObjectStore() {},
    transaction() {
      const tx: Record<string, unknown> = {};
      let pending = 0;
      const done = () => {
        if (--pending === 0) later(() => (tx.oncomplete as () => void)?.());
      };
      const wrap = (run: () => unknown) => {
        pending++;
        return request(run, done, () => later(() => (tx.onabort as () => void)?.()));
      };
      tx.objectStore = (name: string) => {
        const m = stores[name];
        return {
          // out-of-line keys for "blobs", keyPath "id" for "refs"
          put: (v: unknown, k?: string) =>
            wrap(() => {
              if (opts.failPut) throw new Error('quota');
              m.set(k ?? (v as { id: string }).id, v);
            }),
          get: (k: string) => wrap(() => m.get(k)),
          getAll: () => wrap(() => [...m.values()]),
          delete: (k: string) => wrap(() => m.delete(k)),
        };
      };
      return tx;
    },
  };
  const factory = {
    open() {
      const req: Record<string, unknown> = { result: db };
      later(() => {
        if (opts.failOpen) {
          req.error = new Error('denied');
          (req.onerror as () => void)();
          return;
        }
        (req.onupgradeneeded as (() => void) | undefined)?.();
        (req.onsuccess as () => void)();
      });
      return req;
    },
  };
  return { factory: factory as unknown as IDBFactory, data, meta: stores.refs };
}

const blob = (s: string) => new Blob([s], { type: 'image/webp' });

describe('createBlobStore with IndexedDB', () => {
  it('puts, gets and deletes under refId:kind keys', async () => {
    const { factory, data } = fakeFactory();
    const s = createBlobStore(factory);
    expect(await s.put('u-1', 'orig', blob('a'))).toBe(true);
    expect(await s.put('u-1', 'thumb', blob('b'))).toBe(true);
    expect([...data.keys()].sort()).toEqual(['u-1:orig', 'u-1:thumb']);
    expect(await (await s.get('u-1', 'orig'))!.text()).toBe('a');
    expect(await s.get('u-2', 'orig')).toBeUndefined();
    await s.delete('u-1');
    expect(data.size).toBe(0);
  });
});

describe('metadata records', () => {
  it('writes puts and deletes together and reads them back', async () => {
    const { factory, meta } = fakeFactory();
    const s = createBlobStore(factory);
    expect(await s.metaAll()).toEqual([]);
    expect(await s.metaWrite([{ id: 'u-1' }, { id: 'u-2' }], [])).toBe(true);
    expect(await s.metaWrite([{ id: 'u-3' }], ['u-1'])).toBe(true);
    expect([...meta.keys()]).toEqual(['u-2', 'u-3']);
    expect(await s.metaAll()).toEqual([{ id: 'u-2' }, { id: 'u-3' }]);
  });

  it('reports unavailable IndexedDB as null / false so callers can fall back', async () => {
    for (const s of [createBlobStore(null), createBlobStore(fakeFactory({ failOpen: true }).factory)]) {
      expect(await s.metaAll()).toBeNull();
      expect(await s.metaWrite([{ id: 'u-1' }], [])).toBe(false);
    }
    expect(await createBlobStore(fakeFactory({ failPut: true }).factory).metaWrite([{ id: 'u-1' }], [])).toBe(false);
  });
});

describe('createBlobStore fallbacks', () => {
  it('keeps blobs in memory without IndexedDB', async () => {
    const s = createBlobStore(null);
    expect(await s.put('u-1', 'orig', blob('a'))).toBe(false);
    expect(await (await s.get('u-1', 'orig'))!.text()).toBe('a');
    await s.delete('u-1');
    expect(await s.get('u-1', 'orig')).toBeUndefined();
  });

  it('falls back when open fails', async () => {
    const s = createBlobStore(fakeFactory({ failOpen: true }).factory);
    expect(await s.put('u-1', 'thumb', blob('a'))).toBe(false);
    expect(await s.get('u-1', 'thumb')).toBeDefined();
  });

  it('falls back to memory when a write fails', async () => {
    const s = createBlobStore(fakeFactory({ failPut: true }).factory);
    expect(await s.put('u-1', 'orig', blob('a'))).toBe(false);
    expect(await (await s.get('u-1', 'orig'))!.text()).toBe('a');
  });
});
