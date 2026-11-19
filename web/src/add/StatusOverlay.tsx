import type { MouseEvent, PointerEvent } from 'react';
import type { Reference } from '../types';
import { retry } from '../refs/actions';
import './add.css';

const stop = (e: PointerEvent | MouseEvent) => e.stopPropagation();

/**
 * Save state for a user-added reference, drawn over its card: a shimmer and "Saving…" while it
 * is being processed, a red "Couldn't save" with Retry on failure, a spinner dot while it syncs
 * and "Not synced" with Retry when the backend rejected it. Seed references render nothing.
 * The parent must be position: relative and clip overflow.
 */
export function StatusOverlay({ reference: r }: { reference: Reference }) {
  if (!r.userAdded) return null;
  const retryBtn = (
    <button
      type="button"
      className="st-retry"
      draggable={false}
      onPointerDown={stop}
      onClick={(e) => {
        e.stopPropagation();
        retry(r.id);
      }}
    >
      Retry
    </button>
  );

  if (r.status === 'saving') {
    return (
      <>
        <span className="st-shimmer" aria-hidden="true" />
        <span className="st-pill" role="status">
          Saving…
        </span>
      </>
    );
  }
  if (r.status === 'failed') {
    return (
      <span className="st-pill st-pill--failed" title={r.error} role="group" aria-label={`Couldn't save. ${r.error ?? ''}`}>
        Couldn’t save
        {retryBtn}
      </span>
    );
  }
  if (r.sync === 'failed') {
    return (
      <span className="st-pill st-pill--warn" title={r.error} role="group" aria-label={`Not synced. ${r.error ?? ''}`}>
        Not synced
        {retryBtn}
      </span>
    );
  }
  if (r.sync === 'syncing') {
    return <span className="st-spinner" role="status" aria-label="Syncing" title="Syncing" />;
  }
  return null;
}
