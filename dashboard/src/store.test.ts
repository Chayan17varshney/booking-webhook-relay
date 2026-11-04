import { beforeEach, describe, expect, it } from 'vitest';
import { initialState, useStore } from './store';

beforeEach(() => {
  useStore.setState(initialState, true);
});

describe('store', () => {
  it('keeps the API key trimmed and clears any earlier error when connecting', () => {
    useStore.setState({ authError: 'old error' });
    useStore.getState().connect('  my-key  ');
    expect(useStore.getState().apiKey).toBe('my-key');
    expect(useStore.getState().authError).toBeNull();
  });

  it('goes back to page 1 when the filter changes', () => {
    useStore.getState().setPage(3);
    useStore.getState().setStatusFilter('failed');
    expect(useStore.getState().statusFilter).toBe('failed');
    expect(useStore.getState().page).toBe(0);
  });

  it('forgets the key and the selection on sign out, optionally with a reason', () => {
    useStore.getState().connect('k');
    useStore.getState().select('evt_1');
    useStore.getState().setStatusFilter('failed');
    useStore.getState().signOut('That API key was rejected.');
    const state = useStore.getState();
    expect(state.apiKey).toBeNull();
    expect(state.selectedId).toBeNull();
    expect(state.statusFilter).toBe('all');
    expect(state.authError).toBe('That API key was rejected.');

    useStore.getState().signOut();
    expect(useStore.getState().authError).toBeNull();
  });

  it('never persists the key to browser storage', () => {
    useStore.getState().connect('super-secret');
    expect(JSON.stringify({ ...localStorage })).not.toContain('super-secret');
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('super-secret');
  });
});
