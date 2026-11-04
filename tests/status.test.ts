import { allowedFrom, canTransition, isStatus, STATUSES } from '../src/events/status';

describe('event status lifecycle', () => {
  it('allows the forward paths', () => {
    expect(canTransition('received', 'forwarded')).toBe(true);
    expect(canTransition('received', 'retrying')).toBe(true);
    expect(canTransition('retrying', 'forwarded')).toBe(true);
    expect(canTransition('retrying', 'failed')).toBe(true);
    expect(canTransition('retrying', 'retrying')).toBe(true);
  });

  it('allows replaying a failed event', () => {
    expect(canTransition('failed', 'retrying')).toBe(true);
  });

  it('treats forwarded as terminal', () => {
    for (const to of STATUSES) {
      expect(canTransition('forwarded', to)).toBe(false);
    }
  });

  it('never goes back to received', () => {
    for (const from of STATUSES) {
      expect(canTransition(from, 'received')).toBe(false);
    }
  });

  it('does not allow failed to jump straight to forwarded', () => {
    expect(canTransition('failed', 'forwarded')).toBe(false);
  });

  it('lists every status that can reach a target', () => {
    expect(allowedFrom('retrying').sort()).toEqual(['failed', 'received', 'retrying']);
    expect(allowedFrom('received')).toEqual([]);
  });

  it('recognises valid status strings only', () => {
    expect(isStatus('failed')).toBe(true);
    expect(isStatus('done')).toBe(false);
    expect(isStatus(undefined)).toBe(false);
  });
});
