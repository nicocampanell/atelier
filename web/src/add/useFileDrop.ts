import { useEffect, useRef, useState, type DragEvent } from 'react';
import { REF_DRAG_MIME } from '../types';

/** A drag carrying files from outside the page (not a reference dragged from search or the library). */
export function hasFiles(e: { dataTransfer: DataTransfer | null }): boolean {
  const types = Array.from(e.dataTransfer?.types ?? []);
  return types.includes('Files') && !types.includes(REF_DRAG_MIME);
}

interface Options {
  /** Whether this target takes the drag right now. */
  accept(e: DragEvent): boolean;
  onFiles(files: File[], e: DragEvent): void;
}

/** Drag handlers for one drop target; `active` drives the drop tint. */
export function useFileDrop({ accept, onFiles }: Options) {
  const [active, setActive] = useState(false);
  const opts = useRef({ accept, onFiles });
  useEffect(() => {
    opts.current = { accept, onFiles };
  });

  const onDragOver = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    if (!opts.current.accept(e)) {
      setActive(false);
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setActive(true);
  };
  const onDragLeave = (e: DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setActive(false);
  };
  const onDrop = (e: DragEvent) => {
    setActive(false);
    if (!hasFiles(e) || !opts.current.accept(e)) return;
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    if (files.length) opts.current.onFiles(files, e);
  };

  return { active, handlers: { onDragEnter: onDragOver, onDragOver, onDragLeave, onDrop } };
}

/** Keeps a stray file drop from navigating the tab to the file. */
export function useFileDropGuard() {
  useEffect(() => {
    const over = (e: globalThis.DragEvent) => {
      if (!hasFiles(e) || e.defaultPrevented) return; // a drop target already took it
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
    };
    const drop = (e: globalThis.DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);
}
