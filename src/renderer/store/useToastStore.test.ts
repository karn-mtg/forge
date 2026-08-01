import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useToastStore } from './useToastStore';

describe('useToastStore', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('push adds a toast and returns its id', () => {
    const id = useToastStore.getState().push({ type: 'info', title: 'Hello' });
    const { toasts } = useToastStore.getState();
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ id, type: 'info', title: 'Hello', dismissible: true });
  });

  it('dismiss removes the toast by id', () => {
    const id = useToastStore.getState().push({ type: 'success', title: 'Saved' });
    useToastStore.getState().dismiss(id);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('update patches an existing toast', () => {
    const id = useToastStore.getState().push({ type: 'progress', title: 'Uploading', progress: 0 });
    useToastStore.getState().update(id, { progress: 50 });
    expect(useToastStore.getState().toasts[0].progress).toBe(50);
  });

  it('clear removes all toasts', () => {
    useToastStore.getState().push({ type: 'info', title: 'A' });
    useToastStore.getState().push({ type: 'info', title: 'B' });
    useToastStore.getState().clear();
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('auto-dismisses after the default duration for the toast type', () => {
    vi.useFakeTimers();
    useToastStore.getState().push({ type: 'success', title: 'Auto' });
    expect(useToastStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(4000);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('does not auto-dismiss sticky error toasts', () => {
    vi.useFakeTimers();
    useToastStore.getState().push({ type: 'error', title: 'Broken' });
    vi.advanceTimersByTime(60_000);
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });
});
