import { afterEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MAIN_ID, type BoardsStore } from './contracts';

vi.mock('../refs/backend', () => ({ useBackendStatus: () => 'connected', refreshServerSaves: async () => {} }));
vi.mock('../api/client', () => ({
  ApiClientError: class extends Error { status = 0; },
  createProject: vi.fn(async (name: string) => ({ id: 'remote-1', name, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })),
  listProjects: vi.fn(async () => ({ projects: [] })),
  getProjectBoard: vi.fn(async () => ({ id: 'remote-1', items: [], camera: { x: 0, y: 0, zoom: 1 } })),
  putProjectBoard: vi.fn(async (board) => board),
  renameProject: vi.fn(async () => ({})),
  deleteProject: vi.fn(async () => ({ id: 'remote-1' })),
}));
import * as api from '../api/client';
import { useBoards } from './boards';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); localStorage.clear(); });

it('creates a connected project, then renames and deletes its server project', async () => {
  vi.useFakeTimers();
  let store!: BoardsStore;
  function Probe() { store = useBoards(); return null; }
  const root = createRoot(document.createElement('div'));
  await act(async () => { root.render(createElement(Probe)); });
  let id = '';
  await act(async () => { id = store.create('Trip'); await Promise.resolve(); await Promise.resolve(); });
  expect(api.createProject).toHaveBeenCalledWith('Trip');
  expect(store.boards.find((b) => b.id === id)?.serverId).toBe('remote-1');
  await act(async () => { store.rename(id, 'New name'); await vi.advanceTimersByTimeAsync(600); });
  expect(api.renameProject).toHaveBeenCalledWith('remote-1', 'New name');
  await act(async () => { store.remove(id); await vi.advanceTimersByTimeAsync(600); });
  expect(api.deleteProject).toHaveBeenCalledWith('remote-1');
  act(() => root.unmount());
});

it('saves the destination board of a move, so the next refresh does not drop what moved in', async () => {
  vi.useFakeTimers();
  vi.mocked(api.listProjects).mockResolvedValueOnce({ projects: [{ id: 'remote-1', name: 'Saved', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }] });
  let store!: BoardsStore;
  function Probe() { store = useBoards(); return null; }
  const root = createRoot(document.createElement('div'));
  await act(async () => { root.render(createElement(Probe)); await vi.advanceTimersByTimeAsync(0); });
  expect(store.boards.some((b) => b.id === 'remote-1')).toBe(true);
  await act(async () => { store.moveItems(MAIN_ID, [], 'remote-1'); await vi.advanceTimersByTimeAsync(600); });
  expect(api.putProjectBoard).toHaveBeenCalledWith(expect.objectContaining({ id: 'remote-1' }));
  act(() => root.unmount());
});

it('fits a server project with the untouched default camera on first open', async () => {
  vi.mocked(api.listProjects).mockResolvedValueOnce({ projects: [{ id: 'remote-1', name: 'Saved', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }] });
  let store!: BoardsStore;
  function Probe() { store = useBoards(); return null; }
  const root = createRoot(document.createElement('div'));
  await act(async () => { root.render(createElement(Probe)); await Promise.resolve(); await Promise.resolve(); });
  expect(store.boards.find((b) => b.id === 'remote-1')?.camera).toBeNull();
  act(() => root.unmount());
});
