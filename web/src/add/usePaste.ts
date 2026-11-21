import { useEffect, useRef } from 'react';

/** Text that is plainly a link: one token starting with http(s):// or www. */
export function looksLikeUrl(text: string): boolean {
  const t = text.trim();
  return !/\s/.test(t) && /^(https?:\/\/|www\.)[^\s.]+\.\S+$/i.test(t);
}

const isEditable = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el?.tagName && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
};

interface Handlers {
  onFiles(files: File[]): void;
  onLink(url: string): void;
}

/** Window paste: images and URLs are added; other text is left alone. Ignored in inputs and dialogs. */
export function usePaste(handlers: Handlers) {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isEditable(e.target) || document.querySelector('[aria-modal="true"]')) return;
      const data = e.clipboardData;
      if (!data) return;
      let files = Array.from(data.files).filter((f) => f.type.startsWith('image/'));
      if (!files.length) {
        files = Array.from(data.items)
          .filter((i) => i.kind === 'file' && i.type.startsWith('image/'))
          .flatMap((i) => i.getAsFile() ?? []);
      }
      if (files.length) {
        e.preventDefault();
        ref.current.onFiles(files);
        return;
      }
      const text = data.getData('text/plain');
      if (text && looksLikeUrl(text)) {
        e.preventDefault();
        ref.current.onLink(text.trim());
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);
}
