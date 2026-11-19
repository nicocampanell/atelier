import { describe, expect, it, vi } from 'vitest';
import { ApiClientError, createApiClient, type FetchLike } from './client';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function setup(res: Response | (() => Response | Promise<Response>), token: string | null = 'secret-token') {
  const fetch = vi.fn<FetchLike>(async () => (typeof res === 'function' ? res() : res));
  const api = createApiClient({ fetch, getToken: () => token });
  const lastInit = () => fetch.mock.calls.at(-1)![1]!;
  const lastHeaders = () => new Headers(lastInit().headers);
  return { fetch, api, lastInit, lastHeaders };
}

const save = { id: 's1', status: 'accepted' };

describe('api client', () => {
  it('health sends no Authorization header and unwraps data', async () => {
    const { api, fetch, lastHeaders } = setup(json({ ok: true, data: { semantic: true } }));
    await expect(api.health()).resolves.toEqual({ semantic: true });
    expect(fetch.mock.calls[0][0]).toBe('/api/health');
    expect(lastHeaders().has('Authorization')).toBe(false);
  });

  it('sends the bearer token on every other call', async () => {
    const { api, fetch, lastHeaders } = setup(() => json({ ok: true, data: save }));
    await api.listSaves(1);
    expect(fetch.mock.calls.at(-1)![0]).toBe('/api/saves?limit=1');
    expect(lastHeaders().get('Authorization')).toBe('Bearer secret-token');
    await api.getSave('a/b');
    expect(fetch.mock.calls.at(-1)![0]).toBe('/api/saves/a%2Fb');
    await api.retrySave('s1');
    expect(fetch.mock.calls.at(-1)![0]).toBe('/api/saves/s1/retry');
    expect(fetch.mock.calls.at(-1)![1]!.method).toBe('POST');
    await api.deleteSave('s1');
    expect(fetch.mock.calls.at(-1)![1]!.method).toBe('DELETE');
    await api.saveLink('https://example.com');
    for (const call of fetch.mock.calls) expect(new Headers(call[1]!.headers).get('Authorization')).toBe('Bearer secret-token');
  });

  it('never puts the token in a URL', async () => {
    const { api, fetch } = setup(() => json({ ok: true, data: save }));
    await api.getSave('s1');
    await api.listSaves();
    for (const call of fetch.mock.calls) expect(call[0]).not.toContain('secret-token');
  });

  it('uploads as multipart with the field "file" and an optional title', async () => {
    const { api, lastInit, lastHeaders } = setup(json({ ok: true, data: save }));
    const file = new File(['png-bytes'], 'pic.png', { type: 'image/png' });
    await api.uploadImage(file, 'My pic');
    const body = lastInit().body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect((body.get('file') as File).name).toBe('pic.png');
    expect(body.get('title')).toBe('My pic');
    expect(lastHeaders().has('Content-Type')).toBe(false);
  });

  it('saveLink posts JSON', async () => {
    const { api, lastInit, lastHeaders } = setup(json({ ok: true, data: save }));
    await api.saveLink('https://example.com', 'Ex');
    expect(lastHeaders().get('Content-Type')).toBe('application/json');
    expect(JSON.parse(lastInit().body as string)).toEqual({ url: 'https://example.com', title: 'Ex' });
  });

  it('sends capture idempotency keys and encodes search and pagination', async () => {
    const { api, fetch, lastHeaders } = setup(() => json({ ok: true, data: save }));
    await api.saveLink('https://example.com', undefined, 'capture-1');
    expect(lastHeaders().get('Idempotency-Key')).toBe('capture-1');
    await api.listSaves(100, 'a/b');
    expect(fetch.mock.calls.at(-1)![0]).toBe('/api/saves?limit=100&cursor=a%2Fb');
    await api.search('blue & gold');
    expect(fetch.mock.calls.at(-1)![0]).toBe('/api/search?q=blue%20%26%20gold');
  });

  it('fetchAsset returns a blob with the auth header', async () => {
    const { api, fetch, lastHeaders } = setup(() => new Response('x', { headers: { 'Content-Type': 'image/webp' } }));
    const blob = await api.fetchAsset('as1');
    expect(fetch.mock.calls[0][0]).toBe('/api/assets/as1');
    expect(lastHeaders().get('Authorization')).toBe('Bearer secret-token');
    expect(await blob.text()).toBe('x');
  });

  it('maps an ApiResult error to { code, message, status }', async () => {
    const { api } = setup(json({ ok: false, error: { code: 'not_found', message: 'Save not found.' } }, 404));
    await expect(api.getSave('x')).rejects.toMatchObject({ code: 'not_found', message: 'Save not found.', status: 404 });
  });

  it('maps 413 and 415 to friendly messages', async () => {
    const tooBig = setup(json({ ok: false, error: { code: 'too_large', message: 'raw' } }, 413));
    const e1 = await tooBig.api.uploadImage(new File(['x'], 'a.png')).catch((e: unknown) => e);
    expect(e1).toBeInstanceOf(ApiClientError);
    expect(e1).toMatchObject({ code: 'too_large', status: 413 });
    expect((e1 as Error).message).toMatch(/too large/i);

    const bad = setup(json({ ok: false, error: { code: 'x', message: 'raw' } }, 415));
    const e2 = await bad.api.uploadImage(new File(['x'], 'a.png')).catch((e: unknown) => e);
    expect(e2).toMatchObject({ code: 'unsupported_type', status: 415 });
    expect((e2 as Error).message).not.toBe('raw');
  });

  it('maps 401 to unauthorized', async () => {
    const { api } = setup(json({ ok: false, error: { code: 'unauthorized', message: 'nope' } }, 401));
    await expect(api.listSaves(1)).rejects.toMatchObject({ code: 'unauthorized', status: 401 });
  });

  it('maps network errors with status 0', async () => {
    const { api } = setup(() => {
      throw new TypeError('Failed to fetch');
    });
    await expect(api.health()).rejects.toMatchObject({ code: 'network_error', status: 0 });
  });

  it('copes with non-JSON error bodies and success bodies', async () => {
    const html = setup(new Response('<h1>Bad gateway</h1>', { status: 502 }));
    await expect(html.api.health()).rejects.toMatchObject({ code: 'http_502', status: 502 });
    const garbage = setup(new Response('nope', { status: 200 }));
    await expect(garbage.api.health()).rejects.toMatchObject({ code: 'bad_response' });
  });

  it('refuses authenticated calls without a token and does not hit the network', async () => {
    const { api, fetch } = setup(json({ ok: true, data: save }), null);
    await expect(api.listSaves()).rejects.toMatchObject({ code: 'no_token' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reads the token from localStorage by default', async () => {
    localStorage.setItem('atelier-token', 'from-storage');
    const fetch = vi.fn<FetchLike>(async () => json({ ok: true, data: save }));
    await createApiClient({ fetch }).getSave('s1');
    expect(new Headers(fetch.mock.calls[0][1]!.headers).get('Authorization')).toBe('Bearer from-storage');
    localStorage.removeItem('atelier-token');
  });
});
