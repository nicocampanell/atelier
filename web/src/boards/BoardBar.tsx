import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { RenameInput } from './BoardTile';
import './boards.css';

interface Props {
  name: string;
  count: number;
  /** The bar is playing out (a transition is leaving the board). */
  closing: boolean;
  /** Parent board's name when this board is nested; back then returns there. */
  backLabel?: string;
  onBack(): void;
  onRename(name: string): void;
}

/** Floating bottom bar inside a board: back to the overview, board name (click to rename), count. */
export function BoardBar({ name, count, closing, backLabel, onBack, onRename }: Props) {
  const [renaming, setRenaming] = useState(false);
  const label = name || 'Untitled board';
  return (
    <div className="board-bar" data-chrome data-state={closing ? 'closed' : 'open'} inert={closing || undefined} role="group" aria-label="Board">
      <button type="button" className="board-bar__back" aria-label={`Back to ${backLabel ?? 'boards'}`} title={`Back to ${backLabel ?? 'boards'} (Esc)`} onClick={onBack}>
        <ArrowLeft size={16} strokeWidth={1.75} aria-hidden="true" />
        <span>{backLabel ?? 'Boards'}</span>
      </button>
      <span className="board-bar__divider" aria-hidden="true" />
      {renaming ? (
        <RenameInput
          className="board-bar__rename"
          initial={name}
          label="Board name"
          onCommit={(v) => {
            if (v) onRename(v);
            setRenaming(false);
          }}
          onCancel={() => setRenaming(false)}
        />
      ) : (
        <button type="button" className="board-bar__name" title="Rename board" aria-label={`Board name: ${label}. Rename`} onClick={() => setRenaming(true)}>
          {label}
        </button>
      )}
      <span className="board-bar__count">
        · {count} {count === 1 ? 'reference' : 'references'}
      </span>
    </div>
  );
}
