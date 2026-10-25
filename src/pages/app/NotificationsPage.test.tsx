import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { NotificationsPage } from './NotificationsPage';

const mocks = vi.hoisted(() => ({ from: vi.fn(), dbFrom: vi.fn() }));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'current-user' } }),
}));

vi.mock('../../lib/supabase', () => ({
  supabase: { from: mocks.from },
  db: { from: mocks.dbFrom },
}));

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

  it('navigates to the relevant expense and marks notification as read when clicked', async () => {
    const mockNotifications = [
      {
        id: 'notif-1',
        user_id: 'current-user',
        type: 'expense_created',
        title: 'New Expense Added',
        body: 'Alice added Team Lunch',
        data: { expense_id: 'exp-99' },
        read_at: null,
        created_at: '2026-10-24T10:00:00Z',
      },
    ];

    mocks.from.mockImplementation(() => {
      const builder: Record<string, unknown> = {};
      builder.select = vi.fn(() => builder);
      builder.eq = vi.fn(() => builder);
      builder.order = vi.fn(() => builder);
      builder.limit = vi.fn(() => Promise.resolve({ data: mockNotifications, error: null }));
      return builder;
    });

    const updateSpy = vi.fn(() => {
      const builder: Record<string, unknown> = {};
      builder.eq = vi.fn(() => builder);
      builder.is = vi.fn(() => Promise.resolve({ error: null }));
      return builder;
    });
    mocks.dbFrom.mockImplementation(() => ({
      update: updateSpy,
    }));

    render(
      <MemoryRouter initialEntries={['/notifications']}>
        <Routes>
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/expenses/:expenseId" element={<p>Expense detail screen</p>} />
        </Routes>
      </MemoryRouter>
    );

    const itemBtn = await screen.findByText('New Expense Added');
    fireEvent.click(itemBtn);

    // Navigates to expense screen
    expect(await screen.findByText('Expense detail screen')).toBeTruthy();
    // Marks as read in database
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ read_at: expect.any(String) })
    );
  });
});
