import { describe, expect, it } from 'vitest';
import { formatRoute, parseRoute, type Route } from './route';

describe('route', () => {
  it('round-trips', () => {
    const routes: Route[] = [{ name: 'boards' }, { name: 'library' }, { name: 'board', id: 'abc-123' }];
    for (const r of routes) expect(parseRoute(formatRoute(r))).toEqual(r);
  });

  it('formats as documented', () => {
    expect(formatRoute({ name: 'boards' })).toBe('#/boards');
    expect(formatRoute({ name: 'board', id: 'x' })).toBe('#/boards/x');
    expect(formatRoute({ name: 'library' })).toBe('#/library');
  });

  it('unknown or empty hashes go to boards', () => {
    for (const h of ['', '#', '#/', '#/nope', '#/boards/', 'garbage']) {
      expect(parseRoute(h)).toEqual({ name: 'boards' });
    }
  });

  it('encodes ids with special characters', () => {
    const r: Route = { name: 'board', id: 'a/b c#?%' };
    const f = formatRoute(r);
    expect(f.slice('#/boards/'.length)).not.toMatch(/[ ?#/]/);
    expect(parseRoute(f)).toEqual(r);
  });

  it('malformed escapes fall back to boards', () => {
    expect(parseRoute('#/boards/%E0%A4%A')).toEqual({ name: 'boards' });
  });

  it('tolerates trailing slashes', () => {
    expect(parseRoute('#/library/')).toEqual({ name: 'library' });
    expect(parseRoute('#/boards/x/')).toEqual({ name: 'board', id: 'x' });
  });
});
