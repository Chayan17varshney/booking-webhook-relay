import { create } from 'zustand';
import type { EventStatus } from './api/types';

export const PAGE_SIZE = 25;
export type StatusFilter = 'all' | EventStatus;

interface State {
  /** Held in memory only. It is never written to localStorage or the URL, so a refresh signs you out. */
  apiKey: string | null;
  authError: string | null;
  statusFilter: StatusFilter;
  page: number;
  selectedId: string | null;
  autoRefresh: boolean;
  connect: (key: string) => void;
  signOut: (reason?: string) => void;
  setStatusFilter: (filter: StatusFilter) => void;
  setPage: (page: number) => void;
  select: (eventId: string | null) => void;
  setAutoRefresh: (on: boolean) => void;
}

export const useStore = create<State>((set) => ({
  apiKey: null,
  authError: null,
  statusFilter: 'all',
  page: 0,
  selectedId: null,
  autoRefresh: true,
  connect: (key) => set({ apiKey: key.trim(), authError: null }),
  signOut: (reason) => set({ apiKey: null, authError: reason ?? null, selectedId: null, page: 0, statusFilter: 'all' }),
  setStatusFilter: (statusFilter) => set({ statusFilter, page: 0 }),
  setPage: (page) => set({ page }),
  select: (selectedId) => set({ selectedId }),
  setAutoRefresh: (autoRefresh) => set({ autoRefresh }),
}));

export const initialState = useStore.getState();
