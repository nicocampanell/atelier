import { describe, expect, it } from 'vitest';
import { filterReferences } from './SearchBar';
import { REFERENCES } from '../data/references';

describe('filterReferences', () => {
  it('returns everything for an empty query', () => {
    expect(filterReferences('', [])).toHaveLength(REFERENCES.length);
  });

  it('is case-insensitive', () => {
    const a = filterReferences('GREEN VELVET', []).map((r) => r.id);
    expect(a).toContain('r-sofa');
    expect(a).toEqual(filterReferences('green velvet', []).map((r) => r.id));
  });

  it('ANDs multiple words', () => {
    const one = filterReferences('green', []);
    const two = filterReferences('green velvet', []);
    expect(two.length).toBeGreaterThan(0);
    expect(two.length).toBeLessThan(one.length);
    expect(filterReferences('velvet zzzzqq', [])).toEqual([]);
  });

  it('ANDs tags', () => {
    const both = filterReferences('', ['food', 'green']);
    expect(both.length).toBeGreaterThan(0);
    for (const r of both) expect(r.tags).toEqual(expect.arrayContaining(['food', 'green']));
    expect(both.length).toBeLessThan(filterReferences('', ['food']).length);
  });

  it('combines query and tags', () => {
    const r = filterReferences('pizza', ['food']);
    expect(r.map((x) => x.id)).toContain('f-pizza');
    expect(filterReferences('pizza', ['interior'])).toEqual([]);
  });
});
