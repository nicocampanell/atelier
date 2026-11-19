import { useEffect, useRef, useState, type FocusEvent } from 'react';
import type { Reference } from '../types';
import { updateNote } from '../refs/actions';
import './add.css';

/**
 * Inline editor drawn on a note block: a title input and a body textarea. The note is saved
 * when focus leaves the editor (blur), including after Escape.
 */
export function NoteEditor({ reference: r, onDone }: { reference: Reference; onDone(): void }) {
  const [title, setTitle] = useState(r.title === 'Untitled note' ? '' : r.title);
  const [body, setBody] = useState(r.body ?? '');
  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    const el = bodyRef.current;
    el?.focus({ preventScroll: true });
    el?.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const save = () => {
    if (done.current) return;
    done.current = true;
    // Read the live DOM values so a blur that lands before React re-renders never loses text.
    const t = titleRef.current?.value ?? title;
    const b = bodyRef.current?.value ?? body;
    updateNote(r.id, { title: t.trim() || 'Untitled note', body: b.trim() });
    onDone();
  };

  const onBlur = (e: FocusEvent) => {
    if (!rootRef.current?.contains(e.relatedTarget as Node | null)) save();
  };

  return (
    <div
      ref={rootRef}
      className="note-edit"
      data-no-drag
      onBlur={onBlur}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation(); // typing must not nudge, delete or navigate the block
        if (e.key === 'Escape') {
          e.preventDefault();
          (document.activeElement as HTMLElement | null)?.blur();
        }
      }}
    >
      <input
        ref={titleRef}
        className="note-edit__title"
        value={title}
        maxLength={80}
        placeholder="Untitled note"
        aria-label="Note title"
        spellCheck={false}
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        ref={bodyRef}
        className="note-edit__body"
        value={body}
        placeholder="Write something…"
        aria-label="Note text"
        onChange={(e) => setBody(e.target.value)}
      />
    </div>
  );
}
