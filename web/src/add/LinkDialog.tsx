import { useId, useState, type FormEvent } from 'react';
import { Dialog } from './Dialog';

/** `onSubmit` returns an error message to show inline, or null once the link was added. */
export function LinkDialog({ onSubmit, onClose }: { onSubmit(url: string): string | null; onClose(): void }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const errId = useId();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim()) {
      setError('Enter a link to add.');
      return;
    }
    const err = onSubmit(url.trim());
    if (err) setError(err);
    else onClose();
  };

  return (
    <Dialog title="Add a link" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <input
          data-autofocus
          className="dlg__input"
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://example.com"
          aria-label="Link URL"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errId : undefined}
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setError(null);
          }}
        />
        {error && (
          <p id={errId} className="dlg__error" role="alert">
            {error}
          </p>
        )}
        <div className="dlg__row">
          <button type="button" className="dlg__btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="dlg__btn dlg__btn--primary">
            Add
          </button>
        </div>
      </form>
    </Dialog>
  );
}
