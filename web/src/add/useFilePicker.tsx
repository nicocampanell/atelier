import { useCallback, useRef, type ReactNode } from 'react';
import { IMAGE_TYPES } from '../refs/contracts';

/** A hidden multi-file input. Render `input` once; call `open()` from the menu or a shortcut. */
export function useFilePicker(onFiles: (files: File[]) => void): { open(): void; input: ReactNode } {
  const ref = useRef<HTMLInputElement>(null);
  const open = useCallback(() => ref.current?.click(), []);
  const input = (
    <input
      ref={ref}
      type="file"
      multiple
      accept={IMAGE_TYPES.join(',')}
      hidden
      tabIndex={-1}
      aria-hidden="true"
      onChange={(e) => {
        const files = Array.from(e.target.files ?? []);
        e.target.value = ''; // picking the same file twice must still fire
        if (files.length) onFiles(files);
      }}
    />
  );
  return { open, input };
}
