import type { EventStatus } from '../api/types';

export const STATUS_LABELS: Record<EventStatus, string> = {
  received: 'Received',
  retrying: 'Retrying',
  forwarded: 'Forwarded',
  failed: 'Failed',
};

// A glyph is shown beside the colour so status never depends on colour alone.
const GLYPHS: Record<EventStatus, string> = {
  received: '•',
  retrying: '↻',
  forwarded: '✓',
  failed: '✕',
};

export function StatusBadge({ status }: { status: EventStatus }) {
  return (
    <span className={`badge badge-${status}`}>
      <span aria-hidden="true">{GLYPHS[status]}</span> {STATUS_LABELS[status]}
    </span>
  );
}
