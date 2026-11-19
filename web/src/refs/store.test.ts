import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REFERENCES } from '../data/references';
import type { Reference } from '../types';
import { blobStore } from './idb';
import {
  INTERRUPTED_ERROR,
  REFS_STORAGE_KEY,
  _flushPersistForTests,
  _resetForTests,
  ensureOriginal,
  newUserId,
  refsInternal,
  refsStore,
} from './store';

const make = (over: Partial<Reference> = {}): Reference => ({
  id: newUserId(),
  kind: 'note',
  title: 'T',
  source: 'Note',
  tags: ['added'],
  color: '#fffdf6',
  body: 'b',
  w: 240,
  h: 130,
  status: 'ready',
  userAdded: true,
  ...over,
});

const stored = () => JSON.parse(localStorage.getItem(REFS_STORAGE_KEY) ?? 'null');

beforeEach(async () => {
  localStorage.clear();
  await _resetForTests();
});

describe('store basics', () => {
  it('starts with the seeds', () => {
    const s = refsStore.getSnapshot();
    expect(s.list).toHaveLength(REFERENCES.length);
    expect(refsStore.get('r-sofa')?.id).toBe('r-sofa');
    expect(refsStore.has('r-sofa')).toBe(true);
    expect(refsStore.has('nope')).toBe(false);
    expect(refsStore.has('constructor')).toBe(false);
  });

  it('lists user refs newest first, ahead of demo seeds', () => {
    const a = make({ title: 'a' });
    const b = make({ title: 'b' });
    refsInternal.add(a);
    refsInternal.add(b);
    const { list, byId } = refsStore.getSnapshot();
    expect(list.slice(0, 2).map((r) => r.id)).toEqual([b.id, a.id]);
    expect(list.slice(2).map((r) => r.id)).toEqual(REFERENCES.map((r) => r.id));
    expect(byId[a.id].title).toBe('a');
  });

  it('keeps the snapshot identity until something changes, and notifies subscribers', () => {
    const l = vi.fn();
    const off = refsStore.subscribe(l);
    const s1 = refsStore.getSnapshot();
    expect(refsStore.getSnapshot()).toBe(s1);
    const r = make();
    refsInternal.add(r);
    expect(l).toHaveBeenCalledTimes(1);
    const s2 = refsStore.getSnapshot();
    expect(s2).not.toBe(s1);
    refsInternal.update(r.id, { title: 'T' }); // no-op
    expect(refsStore.getSnapshot()).toBe(s2);
    expect(l).toHaveBeenCalledTimes(1);
    refsInternal.update(r.id, { title: 'New' });
    expect(refsStore.get(r.id)!.title).toBe('New');
    expect(l).toHaveBeenCalledTimes(2);
    off();
    refsInternal.update(r.id, { title: 'Newer' });
    expect(l).toHaveBeenCalledTimes(2);
  });

  it('only changes the updated reference object', () => {
    const a = make();
    const b = make();
    refsInternal.add(a);
    refsInternal.add(b);
    const before = refsStore.get(a.id);
    refsInternal.update(b.id, { title: 'x' });
    expect(refsStore.get(a.id)).toBe(before);
  });

  it('removes keys patched to undefined', () => {
    const r = make({ error: 'oops' });
    refsInternal.add(r);
    refsInternal.update(r.id, { error: undefined });
    expect('error' in refsStore.get(r.id)!).toBe(false);
  });

  it('generates u- ids', () => {
    expect(newUserId()).toMatch(/^u-.{8,}/);
    expect(newUserId()).not.toBe(newUserId());
  });
});

describe('id safety', () => {
  it('refuses seed ids, unprefixed ids and duplicates', () => {
    const seed = REFERENCES[0];
    expect(refsInternal.add({ ...make(), id: seed.id })).toBe(false);
    expect(refsStore.get(seed.id)).toBe(seed);
    expect(refsInternal.add({ ...make(), id: 'plain' })).toBe(false);
    const r = make();
    expect(refsInternal.add(r)).toBe(true);
    expect(refsInternal.add({ ...r, title: 'again' })).toBe(false);
  });

  it('cannot update, remove or purge a seed', () => {
    const seed = REFERENCES[0];
    expect(refsInternal.update(seed.id, { title: 'hacked' })).toBe(false);
    expect(refsInternal.remove(seed.id)).toBeUndefined();
    expect(refsInternal.purge(seed.id)).toBeUndefined();
    expect(refsStore.get(seed.id)).toBe(seed);
  });
});

describe('hide / restore / purge', () => {
  it('hides, keeps updates from resurrecting, and restores the latest state', () => {
    const r = make();
    refsInternal.add(r);
    expect(refsInternal.remove(r.id)).toBeDefined();
    expect(refsStore.has(r.id)).toBe(false);
    expect(refsStore.getSnapshot().list.some((x) => x.id === r.id)).toBe(false);
    const snap = refsStore.getSnapshot();
    expect(refsInternal.update(r.id, { title: 'late update' })).toBe(true);
    expect(refsStore.has(r.id)).toBe(false);
    expect(refsStore.getSnapshot()).toBe(snap);
    expect(refsInternal.restore(r.id)).toBe(true);
    expect(refsStore.get(r.id)!.title).toBe('late update');
  });

  it('purges for good', () => {
    const r = make();
    refsInternal.add(r);
    refsInternal.remove(r.id);
    expect(refsInternal.purge(r.id)).toBeDefined();
    expect(refsInternal.getAny(r.id)).toBeUndefined();
    expect(refsInternal.update(r.id, { title: 'x' })).toBe(false);
    expect(refsInternal.restore(r.id)).toBe(false);
  });

  it('revokes replaced and purged object URLs', () => {
    const revoke = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { revokeObjectURL: revoke }));
    const r = make({ kind: 'image', src: 'blob:a', thumbSrc: 'blob:t' });
    refsInternal.add(r);
    refsInternal.update(r.id, { src: 'blob:b' });
    expect(revoke).toHaveBeenCalledWith('blob:a');
    refsInternal.purge(r.id);
    expect(revoke).toHaveBeenCalledWith('blob:b');
    expect(revoke).toHaveBeenCalledWith('blob:t');
    vi.unstubAllGlobals();
  });
});

describe('persistence', () => {
  afterEach(() => vi.useRealTimers());

  it('debounces writes by 250 ms', () => {
    vi.useFakeTimers();
    refsInternal.add(make());
    expect(localStorage.getItem(REFS_STORAGE_KEY)).toBeNull();
    vi.advanceTimersByTime(249);
    expect(localStorage.getItem(REFS_STORAGE_KEY)).toBeNull();
    vi.advanceTimersByTime(1);
    expect(stored().refs).toHaveLength(1);
  });

  it('never persists object URLs and flags blobs', () => {
    const r = make({ kind: 'image', src: 'blob:http://x/1', thumbSrc: 'blob:http://x/2' });
    refsInternal.add(r);
    refsInternal.setHasBlob(r.id, true);
    _flushPersistForTests();
    const text = localStorage.getItem(REFS_STORAGE_KEY)!;
    expect(text).not.toContain('blob:');
    const entry = stored().refs[0];
    expect(entry.hasBlob).toBe(true);
    expect('src' in entry || 'thumbSrc' in entry).toBe(false);
  });
});

describe('hydration', () => {
  const put = (refs: unknown[]) => localStorage.setItem(REFS_STORAGE_KEY, JSON.stringify({ version: 1, refs }));
  const entry = (over: Record<string, unknown> = {}) => ({
    id: 'u-1',
    kind: 'image',
    title: 'Pic',
    source: 'Upload',
    tags: ['added'],
    color: '#112233',
    w: 240,
    h: 180,
    status: 'ready',
    hasBlob: false,
    ...over,
  });

  it('loads valid entries synchronously and drops invalid ones', async () => {
    put([
      entry({ id: 'u-note', kind: 'note', status: 'ready', body: 'hi' }),
      entry({ id: 'r-sofa', kind: 'note' }),
      entry({ id: 'no-prefix', kind: 'note' }),
      entry({ id: 'u-bad-kind', kind: 'video' }),
      entry({ id: 'u-bad-size', kind: 'note', w: -1 }),
      entry({ id: 'u-note', kind: 'note', title: 'dup' }),
      'garbage',
      null,
    ]);
    await _resetForTests({ hydrate: true });
    const users = refsStore.getSnapshot().list.filter((r) => r.userAdded);
    expect(users.map((u) => u.id)).toEqual(['u-note']);
    expect(users[0].title).toBe('Pic');
    expect(refsStore.get('r-sofa')!.userAdded).toBeUndefined();
  });

  it('survives corrupt JSON', async () => {
    localStorage.setItem(REFS_STORAGE_KEY, '{nope');
    await _resetForTests({ hydrate: true });
    expect(refsStore.getSnapshot().list).toHaveLength(REFERENCES.length);
  });

  it('turns "saving" into "failed" and says to upload again when no blob exists', async () => {
    put([entry({ id: 'u-a', status: 'saving', hasBlob: false }), entry({ id: 'u-b', status: 'saving', hasBlob: true })]);
    await _resetForTests({ hydrate: true });
    const a = refsStore.get('u-a')!;
    expect(a.status).toBe('failed');
    expect(a.error).toContain(INTERRUPTED_ERROR);
    expect(a.error).toMatch(/upload it again/i);
    const b = refsStore.get('u-b')!;
    expect(b.status).toBe('failed');
    expect(b.error).toBe(INTERRUPTED_ERROR);
  });

  it('marks an interrupted sync as failed', async () => {
    put([entry({ id: 'u-s', kind: 'link', sync: 'syncing', serverId: 's9' })]);
    await _resetForTests({ hydrate: true });
    const r = refsStore.get('u-s')!;
    expect(r.sync).toBe('failed');
    expect(r.serverId).toBe('s9');
    expect(r.error).toMatch(/^Not synced/);
  });

  it('flags a ready image whose blobs are gone', async () => {
    put([entry({ id: 'u-lost', hasBlob: true })]);
    await _resetForTests({ hydrate: true });
    expect(refsStore.get('u-lost')!.status).toBe('failed');
  });

  it('creates thumbnail URLs only; the original loads once on demand', async () => {
    const created: string[] = [];
    const revoke = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => `blob:test/${created.push('x')}`, revokeObjectURL: revoke }));
    await blobStore.put('u-img', 'orig', new Blob(['o']));
    await blobStore.put('u-img', 'thumb', new Blob(['t']));
    const origGet = vi.spyOn(blobStore, 'get');
    put([entry({ id: 'u-img', hasBlob: true })]);
    await _resetForTests({ hydrate: true });
    let r = refsStore.get('u-img')!;
    expect(r.status).toBe('ready');
    expect(r.src).toBeUndefined();
    expect(r.thumbSrc).toBe('blob:test/1');
    expect(origGet).not.toHaveBeenCalledWith('u-img', 'orig');

    const l = vi.fn();
    const off = refsStore.subscribe(l);
    const [a, b] = await Promise.all([ensureOriginal('u-img'), ensureOriginal('u-img')]);
    expect(a).toBe('blob:test/2');
    expect(b).toBe(a);
    expect(await ensureOriginal('u-img')).toBe(a);
    expect(origGet.mock.calls.filter((c) => c[1] === 'orig')).toHaveLength(1);
    expect(l).toHaveBeenCalledTimes(1);
    r = refsStore.get('u-img')!;
    expect(r.src).toBe(a);
    expect(r.thumbSrc).toBe('blob:test/1');
    off();

    refsInternal.purge('u-img');
    expect(revoke).toHaveBeenCalledWith('blob:test/1');
    expect(revoke).toHaveBeenCalledWith('blob:test/2');
    expect(await ensureOriginal('u-img')).toBeUndefined();
    expect(await ensureOriginal('r-sofa')).toBe(REFERENCES.find((x) => x.id === 'r-sofa')!.src);
    await blobStore.delete('u-img');
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('falls back to the original when an image has no thumbnail', async () => {
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:test/only' }));
    await blobStore.put('u-nothumb', 'orig', new Blob(['o']));
    put([entry({ id: 'u-nothumb', hasBlob: true })]);
    await _resetForTests({ hydrate: true });
    expect(refsStore.get('u-nothumb')!.thumbSrc).toBe('blob:test/only');
    await blobStore.delete('u-nothumb');
    vi.unstubAllGlobals();
  });
});

/** Metadata in IndexedDB, with blobStore's meta calls replaced by an in-memory table. */
describe('IndexedDB metadata', () => {
  let table: Map<string, Record<string, unknown>>;
  let failWrites = false;
  let writes: { puts: string[]; deletes: string[] }[];
  const seedLocal = (refs: unknown[]) => localStorage.setItem(REFS_STORAGE_KEY, JSON.stringify({ version: 1, refs }));
  const row = (id: string, seq: number, over: Record<string, unknown> = {}) => ({
    id,
    seq,
    kind: 'note',
    title: id,
    source: 'Note',
    tags: [],
    color: '#112233',
    w: 240,
    h: 130,
    status: 'ready',
    hasBlob: false,
    ...over,
  });
  const ids = () => refsStore.getSnapshot().list.filter((r) => r.userAdded).map((r) => r.id);

  beforeEach(() => {
    table = new Map();
    failWrites = false;
    writes = [];
    vi.spyOn(blobStore, 'metaAll').mockImplementation(async () => [...table.values()]);
    vi.spyOn(blobStore, 'metaWrite').mockImplementation(async (puts, deletes) => {
      if (failWrites) return false;
      writes.push({ puts: puts.map((p) => p.id), deletes });
      for (const p of puts) table.set(p.id, structuredClone(p) as Record<string, unknown>);
      for (const d of deletes) table.delete(d);
      return true;
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('loads records newest first by seq', async () => {
    for (const r of [row('u-old', 1), row('u-new', 9), row('u-mid', 5)]) table.set(r.id, r);
    await _resetForTests({ hydrate: true });
    expect(ids()).toEqual(['u-new', 'u-mid', 'u-old']);
    const next = make();
    refsInternal.add(next);
    await _flushPersistForTests();
    expect(table.get(next.id)!.seq).toBe(10);
    await _resetForTests({ hydrate: true });
    expect(ids()[0]).toBe(next.id);
  });

  it('writes only the changed records, and deletes purged ones', async () => {
    for (const r of [row('u-a', 1), row('u-b', 2)]) table.set(r.id, r);
    await _resetForTests({ hydrate: true });
    expect(writes).toEqual([]); // loading rewrites nothing
    refsInternal.update('u-a', { title: 'A2' });
    await _flushPersistForTests();
    expect(writes).toEqual([{ puts: ['u-a'], deletes: [] }]);
    expect(table.get('u-a')!.title).toBe('A2');
    expect(localStorage.getItem(REFS_STORAGE_KEY)).toBeNull();

    refsInternal.purge('u-b');
    await _flushPersistForTests();
    expect(writes[1]).toEqual({ puts: [], deletes: ['u-b'] });
    expect([...table.keys()]).toEqual(['u-a']);
    await _flushPersistForTests();
    expect(writes).toHaveLength(2); // nothing pending, nothing written
  });

  it('does not rewrite a record when only an object URL changed, and never stores one', async () => {
    table.set('u-i', row('u-i', 1, { kind: 'image', serverId: 's1' }));
    await _resetForTests({ hydrate: true });
    refsInternal.update('u-i', { src: 'blob:x/1', thumbSrc: 'blob:x/2' });
    await _flushPersistForTests();
    expect(writes).toEqual([]);
    refsInternal.update('u-i', { title: 'T' });
    await _flushPersistForTests();
    expect(JSON.stringify(table.get('u-i'))).not.toContain('blob:');
  });

  it('keeps changes pending when a write fails and retries them with the next flush', async () => {
    await _resetForTests({ hydrate: true });
    const r = make();
    refsInternal.add(r);
    failWrites = true;
    await _flushPersistForTests();
    expect(table.size).toBe(0);
    failWrites = false;
    await _flushPersistForTests();
    expect([...table.keys()]).toEqual([r.id]);
  });

  it('migrates localStorage once, removing the key only after the IndexedDB write', async () => {
    seedLocal([row('u-x', 0, { title: 'X' }), row('u-y', 0, { title: 'Y' })]);
    await _resetForTests({ hydrate: true });
    expect(ids()).toEqual(['u-x', 'u-y']);
    expect([...table.keys()].sort()).toEqual(['u-x', 'u-y']);
    expect(table.get('u-x')!.seq).toBeGreaterThan(table.get('u-y')!.seq as number);
    expect(localStorage.getItem(REFS_STORAGE_KEY)).toBeNull();
    // second start reads IndexedDB alone
    await _resetForTests({ hydrate: true });
    expect(ids()).toEqual(['u-x', 'u-y']);
  });

  it('keeps localStorage untouched and stays on it when the migration write fails', async () => {
    seedLocal([row('u-x', 0)]);
    const before = localStorage.getItem(REFS_STORAGE_KEY);
    failWrites = true;
    await _resetForTests({ hydrate: true });
    expect(ids()).toEqual(['u-x']);
    expect(localStorage.getItem(REFS_STORAGE_KEY)).toBe(before);
    expect(table.size).toBe(0);
    refsInternal.add(make()); // later saves keep going to localStorage
    await _flushPersistForTests();
    expect(stored().refs).toHaveLength(2);
  });

  it('prefers IndexedDB over a leftover localStorage key and leaves that key alone', async () => {
    table.set('u-db', row('u-db', 1));
    seedLocal([row('u-ls', 0)]);
    await _resetForTests({ hydrate: true });
    expect(ids()).toEqual(['u-db']);
    expect(stored().refs[0].id).toBe('u-ls');
  });

  it('uses localStorage when IndexedDB is unavailable', async () => {
    vi.mocked(blobStore.metaAll).mockResolvedValue(null);
    seedLocal([row('u-ls', 0)]);
    await _resetForTests({ hydrate: true });
    expect(ids()).toEqual(['u-ls']);
    refsInternal.update('u-ls', { title: 'new' });
    await _flushPersistForTests();
    expect(stored().refs[0].title).toBe('new');
    expect(blobStore.metaWrite).not.toHaveBeenCalled();
  });
});
