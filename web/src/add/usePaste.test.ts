import { describe, expect, it } from 'vitest';
import { looksLikeUrl } from './usePaste';

describe('looksLikeUrl', () => {
  it('accepts http(s) and www links', () => {
    expect(looksLikeUrl('https://are.na/block/1')).toBe(true);
    expect(looksLikeUrl(' http://example.com ')).toBe(true);
    expect(looksLikeUrl('www.example.com/a?b=1')).toBe(true);
  });
  it('ignores ordinary text', () => {
    expect(looksLikeUrl('hello world')).toBe(false);
    expect(looksLikeUrl('notes.md')).toBe(false);
    expect(looksLikeUrl('see https://example.com now')).toBe(false);
    expect(looksLikeUrl('https://')).toBe(false);
  });
});
