import './boards.css';

export interface ToastState {
  key: number;
  text: string;
  /** Board to open from the toast's action; omitted for plain notices. */
  boardId?: string;
}

/** Small status toast at the bottom center. The owner clears it after 2.4s. */
export function Toast({ toast, onOpen }: { toast: ToastState | null; onOpen(id: string): void }) {
  if (!toast) return null;
  return (
    <div className="toast" key={toast.key} role="status">
      <span className="toast__text">{toast.text}</span>
      {toast.boardId && (
        <button type="button" className="toast__action" onClick={() => onOpen(toast.boardId!)}>
          Open
        </button>
      )}
    </div>
  );
}
