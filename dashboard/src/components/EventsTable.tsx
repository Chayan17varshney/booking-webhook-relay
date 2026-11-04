import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';
import type { EventRecord } from '../api/types';
import { formatDateTime, maskEmail, relativeTime, truncate } from '../utils/format';
import { StatusBadge } from './StatusBadge';

interface Props {
  items: EventRecord[];
  selectedId: string | null;
  onSelect: (eventId: string) => void;
}

export function EventsTable({ items, selectedId, onSelect }: Props) {
  const columns = useMemo<ColumnDef<EventRecord>[]>(
    () => [
      {
        header: 'Event',
        accessorKey: 'eventId',
        cell: ({ row }) => (
          <button
            type="button"
            className="link"
            aria-label={`Open details for ${row.original.eventId}`}
            onClick={() => onSelect(row.original.eventId)}
          >
            {row.original.eventId}
          </button>
        ),
      },
      { header: 'Status', accessorKey: 'status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
      { header: 'Customer', accessorFn: (row) => maskEmail(row.payload.customer.email) },
      { header: 'Service', accessorFn: (row) => row.payload.service },
      { header: 'Attempts', accessorKey: 'attempts' },
      {
        header: 'Received',
        accessorKey: 'receivedAt',
        cell: ({ row }) => (
          <time dateTime={row.original.receivedAt} title={formatDateTime(row.original.receivedAt)}>
            {relativeTime(row.original.receivedAt)}
          </time>
        ),
      },
      {
        header: 'Last error',
        accessorKey: 'lastError',
        cell: ({ row }) =>
          row.original.lastError ? (
            <span title={row.original.lastError}>{truncate(row.original.lastError, 50)}</span>
          ) : (
            <span className="muted">—</span>
          ),
      },
    ],
    [onSelect],
  );

  const table = useReactTable({ data: items, columns, getCoreRowModel: getCoreRowModel() });

  return (
    <div className="table-wrap">
      <table>
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => (
                <th key={header.id} scope="col">
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className={row.original.eventId === selectedId ? 'row-selected' : undefined}>
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
