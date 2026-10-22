import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SheetDialog } from './SheetDialog';

describe('SheetDialog', () => {
  it('exposes the dialog name and closes on Escape cancellation', () => {
    const onClose = vi.fn();
    render(
      <SheetDialog title="Add expense" onClose={onClose}>
        <button>Continue</button>
      </SheetDialog>
    );

    const dialog = screen.getByRole('dialog', { name: 'Add expense' });
    expect(dialog.hasAttribute('open')).toBe(true);
    fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes when the backdrop itself is clicked', () => {
    const onClose = vi.fn();
    render(
      <SheetDialog title="Split method" onClose={onClose}>
        <button>Continue</button>
      </SheetDialog>
    );

    fireEvent.click(screen.getByRole('dialog', { name: 'Split method' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
