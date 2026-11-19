import { describe, expect, it } from 'vitest';

describe('addNote with an empty body', () => {
  it('accepts an empty body when a title is given (new note flow)', async () => {
    const { addNote } = await import('./actions');
    const r = addNote('', 'Untitled note');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.ref.title).toBe('Untitled note');
      expect(r.ref.body).toBe('');
      expect(r.ref.h).toBeGreaterThanOrEqual(130);
    }
  });
  it('still rejects a note with neither body nor title', async () => {
    const { addNote } = await import('./actions');
    expect(addNote('   ').ok).toBe(false);
  });
});
