import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useConfirmStore } from './useConfirmStore';

describe('useConfirmStore', () => {
  beforeEach(() => {
    useConfirmStore.setState({ isOpen: false, options: null });
  });

  it('show opens the dialog with the given options', () => {
    const onConfirm = vi.fn();
    useConfirmStore.getState().show({ title: 'Delete?', message: 'Sure?', onConfirm });
    const { isOpen, options } = useConfirmStore.getState();
    expect(isOpen).toBe(true);
    expect(options?.title).toBe('Delete?');
  });

  it('confirm closes the dialog and runs onConfirm, not onCancel', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    useConfirmStore.getState().show({ title: 'Delete?', message: 'Sure?', onConfirm, onCancel });

    await useConfirmStore.getState().confirm();

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    expect(useConfirmStore.getState().isOpen).toBe(false);
    expect(useConfirmStore.getState().options).toBeNull();
  });

  it('dismiss closes the dialog and runs onCancel, not onConfirm', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    useConfirmStore.getState().show({ title: 'Delete?', message: 'Sure?', onConfirm, onCancel });

    useConfirmStore.getState().dismiss();

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(useConfirmStore.getState().isOpen).toBe(false);
  });

  it('dismiss is safe when no onCancel was provided', () => {
    useConfirmStore.getState().show({ title: 'Delete?', message: 'Sure?', onConfirm: vi.fn() });
    expect(() => useConfirmStore.getState().dismiss()).not.toThrow();
  });
});
