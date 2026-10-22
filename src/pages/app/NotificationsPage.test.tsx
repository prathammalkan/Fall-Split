import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { NotificationsPage } from './NotificationsPage';

const mocks = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'current-user' } }),
}));

vi.mock('../../lib/supabase', () => ({ supabase: { from: mocks.from }, db: { from: vi.fn() } }));

describe('NotificationsPage', () => {
  it('shows a recoverable error rather than a false empty state when reads fail', async () => {
    mocks.from.mockImplementation(() => {
      const builder: Record<string, unknown> = {};
      builder.select = vi.fn(() => builder);
      builder.eq = vi.fn(() => builder);
      builder.order = vi.fn(() => builder);
      builder.limit = vi.fn(() =>
        Promise.resolve({ data: null, error: new Error('network unavailable') })
      );
      return builder;
    });

    render(
      <MemoryRouter>
        <NotificationsPage />
      </MemoryRouter>
    );

    expect(await screen.findByText(/Notifications could not be loaded/)).toBeTruthy();
    expect(screen.queryByText('No notifications')).toBeNull();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
