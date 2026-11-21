import { describe, expect, it } from 'vitest';
import { refsStore } from '../refs/store';
import './seed';

describe('dev seed', () => {
  it('seeds n notes and unseed removes exactly those', () => {
    const before = refsStore.getSnapshot().list.length;
    expect(window.__atelierSeed!(25)).toBe(25);
    expect(refsStore.getSnapshot().list).toHaveLength(before + 25);
    expect(window.__atelierUnseed!()).toBe(25);
    expect(refsStore.getSnapshot().list).toHaveLength(before);
  });
});
