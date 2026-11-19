import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Reference } from '../types';

vi.mock('../api/client', () => {
  class ApiClientError extends Error {
    code: string;
    status: number;
    constructor(code: string, message: string, status: number) {
      super(message);
      this.code = code;
      this.status = status;
    }
  }
  return {
    ApiClientError,
    health: vi.fn(),
    listSaves: vi.fn(),
    uploadImage: vi.fn(),
    saveLink: vi.fn(),
    getSave: vi.fn(),
    retrySave: vi.fn(),
    deleteSave: vi.fn(async () => ({ id: 'x' })),
    fetchAsset: vi.fn(),
    writeToken: vi.fn(),
  };
});

import * as api from '../api/client';
import { _resetBackendForTests, connectBackend, disconnectBackend, getBackendStatus, refreshServerSaves, syncRef } from './backend';
import { blobStore } from './idb';
import { removeRef } from './actions';
import { _resetForTests, newUserId, refsInternal, refsStore } from './store';

const E = api.ApiClientError as unknown as new (c: string, m: string, s: number) => Error;
const save = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  kind: 'image',
  title: 'Saved title',
  description: null,
  previewUrl: null,
  asset: null,
  status: 'accepted',
  error: null,
  sourceUrl: null,
  duplicateOf: null,
  createdAt: '',
  ...over,
});

async function addReady(over: Partial<Reference> = {}): Promise<string> {
  const r: Reference = {
    id: newUserId(),
    kind: 'image',
    title: 'Pic',
    source: 'Upload',
    tags: ['added'],
    color: '#fff',
    w: 240,
    h: 180,
    status: 'ready',
    sync: 'local',
    userAdded: true,
    ...over,
  };
  refsInternal.add(r);
  if (r.kind === 'image') await blobStore.put(r.id, 'orig', new Blob(['o'], { type: 'image/webp' }));
  return r.id;
}

/** Runs a sync to completion under fake timers. */
async function run(id: string, opts?: { retry?: boolean }) {
  const p = syncRef(id, opts);
  await vi.advanceTimersByTimeAsync(100_000);
  await p;
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  localStorage.clear();
  await _resetForTests();
  _resetBackendForTests('connected');
});
afterEach(() => vi.useRealTimers());

describe('syncRef', () => {
  it('does nothing when not connected', async () => {
    _resetBackendForTests('off');
    const id = await addReady();
    await run(id);
    expect(api.uploadImage).not.toHaveBeenCalled();
    expect(refsStore.get(id)!.sync).toBe('local');
  });

  it('uploads the original, polls every second until ready, then marks synced', async () => {
    vi.mocked(api.uploadImage).mockResolvedValue(save() as never);
    vi.mocked(api.getSave)
      .mockResolvedValueOnce(save({ status: 'processing' }) as never)
      .mockResolvedValueOnce(save({ status: 'ready' }) as never);
    const id = await addReady();
    const p = syncRef(id);
    await vi.advanceTimersByTimeAsync(0);
    expect(refsStore.get(id)).toMatchObject({ sync: 'syncing', serverId: 's1' });
    expect(vi.mocked(api.uploadImage).mock.calls[0][0]).toBeInstanceOf(File);
    expect(api.getSave).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.getSave).toHaveBeenCalledTimes(1);
    expect(refsStore.get(id)!.sync).toBe('syncing');
    await vi.advanceTimersByTimeAsync(1000);
    await p;
    expect(api.getSave).toHaveBeenCalledTimes(2);
    expect(refsStore.get(id)).toMatchObject({ sync: 'synced', status: 'ready' });
  });

  it('marks sync failed (item stays ready) when the backend reports failure', async () => {
    vi.mocked(api.uploadImage).mockResolvedValue(save({ status: 'failed', error: 'Corrupt image' }) as never);
    const id = await addReady();
    await run(id);
    expect(refsStore.get(id)).toMatchObject({ sync: 'failed', status: 'ready', error: 'Not synced: Corrupt image' });
  });

  it('shows the friendly message for 413 and 415', async () => {
    vi.mocked(api.uploadImage).mockRejectedValue(new E('too_large', 'That file is too large.', 413));
    const id = await addReady();
    await run(id);
    expect(refsStore.get(id)).toMatchObject({ sync: 'failed', error: 'Not synced: That file is too large.' });
  });

  it('reports an unreachable backend', async () => {
    vi.mocked(api.uploadImage).mockRejectedValue(new E('network_error', "Couldn't reach the backend.", 0));
    const id = await addReady();
    await run(id);
    expect(refsStore.get(id)).toMatchObject({ sync: 'failed', status: 'ready' });
    expect(refsStore.get(id)!.error).toMatch(/^Not synced/);
    expect(getBackendStatus()).toBe('unreachable');
  });

  it('gives up after 90 polls', async () => {
    vi.mocked(api.uploadImage).mockResolvedValue(save() as never);
    vi.mocked(api.getSave).mockResolvedValue(save({ status: 'processing' }) as never);
    const id = await addReady();
    await run(id);
    expect(api.getSave).toHaveBeenCalledTimes(90);
    expect(refsStore.get(id)).toMatchObject({ sync: 'failed' });
    expect(refsStore.get(id)!.error).toMatch(/still working/);
  });

  it('retry resumes from the serverId and retries a failed save', async () => {
    vi.mocked(api.getSave).mockResolvedValueOnce(save({ status: 'failed', error: 'x' }) as never);
    vi.mocked(api.retrySave).mockResolvedValue(save({ status: 'ready' }) as never);
    const id = await addReady({ serverId: 's1', sync: 'failed', error: 'Not synced: x' });
    await run(id, { retry: true });
    expect(api.uploadImage).not.toHaveBeenCalled();
    expect(api.retrySave).toHaveBeenCalledWith('s1');
    expect(refsStore.get(id)).toMatchObject({ sync: 'synced' });
    expect(refsStore.get(id)!.error).toBeUndefined();
  });

  it('links: saves the url, fills title/description and stores the thumbnail', async () => {
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:thumb', revokeObjectURL: vi.fn() }));
    vi.mocked(api.saveLink).mockResolvedValue(save({ kind: 'url', status: 'accepted' }) as never);
    vi.mocked(api.getSave).mockResolvedValue(
      save({ kind: 'url', status: 'ready', title: 'Real Title', description: 'About it', previewUrl: '/api/assets/a1' }) as never,
    );
    vi.mocked(api.fetchAsset).mockResolvedValue(new Blob(['img'], { type: 'image/png' }));
    const id = await addReady({ kind: 'link', title: 'example.com', url: 'https://example.com/', body: 'https://example.com/' });
    await run(id);
    expect(api.saveLink).toHaveBeenCalledWith('https://example.com/', undefined, id);
    expect(api.fetchAsset).toHaveBeenCalledWith('a1');
    expect(refsStore.get(id)).toMatchObject({ sync: 'synced', title: 'Real Title', body: 'About it', thumbSrc: 'blob:thumb' });
    expect(await blobStore.get(id, 'thumb')).toBeDefined();
    expect(refsInternal.hasBlob(id)).toBe(true);
    vi.unstubAllGlobals();
  });

  it('never sends the token to a third-party preview URL', async () => {
    const fetchSpy = vi.fn(async () => new Response('no', { status: 404 }));
    vi.stubGlobal('fetch', fetchSpy);
    vi.mocked(api.saveLink).mockResolvedValue(save({ status: 'ready', previewUrl: 'https://cdn.example.org/x.jpg' }) as never);
    const id = await addReady({ kind: 'link', url: 'https://example.com/' });
    await run(id);
    expect(api.fetchAsset).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledWith('https://cdn.example.org/x.jpg', { credentials: 'omit' });
    expect(refsStore.get(id)!.sync).toBe('synced');
    vi.unstubAllGlobals();
  });
});

describe('connect / disconnect', () => {
  it('connects when health and an authenticated list succeed', async () => {
    vi.mocked(api.health).mockResolvedValue({ semantic: false });
    vi.mocked(api.listSaves).mockResolvedValue({ saves: [], next: null });
    expect(await connectBackend(' tok ')).toBe('connected');
    expect(api.writeToken).toHaveBeenCalledWith('tok');
    expect(getBackendStatus()).toBe('connected');
  });

  it('reports unauthorized and unreachable', async () => {
    vi.mocked(api.health).mockResolvedValue({ semantic: false });
    vi.mocked(api.listSaves).mockRejectedValue(new E('unauthorized', 'no', 401));
    expect(await connectBackend('bad')).toBe('unauthorized');
    vi.mocked(api.health).mockRejectedValue(new E('network_error', 'down', 0));
    expect(await connectBackend('tok')).toBe('unreachable');
  });

  it('disconnect clears the token, leaves items alone and stops in-flight syncs', async () => {
    vi.mocked(api.uploadImage).mockResolvedValue(save() as never);
    vi.mocked(api.getSave).mockResolvedValue(save({ status: 'processing' }) as never);
    const id = await addReady();
    const done = await addReady({ sync: 'synced', serverId: 'zz' });
    const p = syncRef(id);
    await vi.advanceTimersByTimeAsync(1500);
    disconnectBackend();
    await vi.advanceTimersByTimeAsync(100_000);
    await p;
    expect(api.writeToken).toHaveBeenCalledWith(null);
    expect(getBackendStatus()).toBe('off');
    expect(refsStore.get(done)).toMatchObject({ sync: 'synced', serverId: 'zz', status: 'ready' });
    expect(refsStore.get(id)!.sync).toBe('failed');
    expect(vi.mocked(api.getSave).mock.calls.length).toBeLessThan(5);
  });
});


describe('server capture import', () => {
  it('keeps paginated captures newest first and puts later captures at the top', async () => {
    vi.mocked(api.listSaves)
      .mockResolvedValueOnce({ saves: [save({ id: 'newest' }), save({ id: 'middle' })], next: 'older' } as never)
      .mockResolvedValueOnce({ saves: [save({ id: 'oldest' })], next: null } as never);
    await refreshServerSaves();
    expect(refsStore.getSnapshot().list.slice(0, 3).map((r) => r.serverId)).toEqual(['newest', 'middle', 'oldest']);
    vi.mocked(api.listSaves).mockResolvedValueOnce({ saves: [save({ id: 'later' }), save({ id: 'newest' }), save({ id: 'middle' }), save({ id: 'oldest' })], next: null } as never);
    await refreshServerSaves();
    expect(refsStore.getSnapshot().list.slice(0, 4).map((r) => r.serverId)).toEqual(['later', 'newest', 'middle', 'oldest']);
  });

  it('imports every page once and retains existing local references', async () => {
    await addReady({ title: 'Local' });
    vi.mocked(api.listSaves).mockResolvedValueOnce({ saves: [save({ id: 'one', kind: 'url', sourceUrl: 'https://example.com' })], next: 'next' } as never)
      .mockResolvedValueOnce({ saves: [save({ id: 'two', kind: 'url' })], next: null } as never)
      .mockResolvedValueOnce({ saves: [save({ id: 'one', kind: 'url' }), save({ id: 'two', kind: 'url' })], next: null } as never);
    await refreshServerSaves();
    await refreshServerSaves();
    expect(api.listSaves).toHaveBeenCalledWith(100, 'next');
    expect(refsStore.getSnapshot().list.filter((r) => r.serverId).map((r) => r.serverId).sort()).toEqual(['one', 'two']);
    expect(refsStore.getSnapshot().list.some((r) => r.title === 'Local')).toBe(true);
  });
});


describe('server lifecycle reconciliation', () => {
  it('updates processing and failed saves, then removes a save deleted elsewhere', async () => {
    const page = (entry: ReturnType<typeof save> | null) => ({ saves: entry ? [entry] : [], next: null });
    vi.mocked(api.listSaves).mockResolvedValueOnce(page(save({ kind: 'url', status: 'accepted' })) as never)
      .mockResolvedValueOnce(page(save({ kind: 'url', status: 'ready', title: 'Processed', description: 'Details' })) as never)
      .mockResolvedValueOnce(page(save({ kind: 'url', status: 'failed', error: 'Failed processing' })) as never)
      .mockResolvedValueOnce(page(null) as never);
    await refreshServerSaves();
    const id = refsStore.getSnapshot().list.find((r) => r.serverId === 's1')!.id;
    expect(refsStore.get(id)).toMatchObject({ status: 'saving', sync: 'syncing' });
    await refreshServerSaves();
    expect(refsStore.get(id)).toMatchObject({ status: 'ready', sync: 'synced', title: 'Processed', body: 'Details' });
    await refreshServerSaves();
    expect(refsStore.get(id)).toMatchObject({ status: 'failed', error: 'Failed processing' });
    await refreshServerSaves();
    expect(refsStore.get(id)).toBeUndefined();
  });

  it('keeps known saves when a later page fails', async () => {
    vi.mocked(api.listSaves).mockResolvedValueOnce({ saves: [save({ kind: 'url', status: 'ready' })], next: null } as never);
    await refreshServerSaves();
    const id = refsStore.getSnapshot().list.find((r) => r.serverId === 's1')!.id;
    vi.mocked(api.listSaves).mockResolvedValueOnce({ saves: [], next: 'later' } as never).mockRejectedValueOnce(new Error('network'));
    await refreshServerSaves();
    expect(refsStore.get(id)).toBeDefined();
  });

  it('does not resurrect a save during its undo window or while deletion settles', async () => {
    const page = { saves: [save({ kind: 'url', status: 'ready' })], next: null };
    vi.mocked(api.listSaves).mockResolvedValue(page as never);
    await refreshServerSaves();
    const id = refsStore.getSnapshot().list.find((r) => r.serverId === 's1')!.id;
    const removal = removeRef(id)!;
    await refreshServerSaves();
    expect(refsStore.get(id)).toBeUndefined();
    removal.undo();
    expect(refsStore.get(id)?.serverId).toBe('s1');
    const committed = removeRef(id)!;
    committed.commit();
    await refreshServerSaves();
    expect(refsStore.getSnapshot().list.filter((r) => r.serverId === 's1')).toHaveLength(0);
  });
});
