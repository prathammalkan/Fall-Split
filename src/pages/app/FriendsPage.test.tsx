import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FriendsPage } from './FriendsPage';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  dbFrom: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  user: { id: 'current-user' },
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: mocks.user, emailVerified: true }),
}));

vi.mock('../../lib/supabase', () => ({
  supabase: { from: mocks.from, rpc: mocks.rpc },
  db: { from: mocks.dbFrom },
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <FriendsPage />
    </MemoryRouter>
  );
}

describe('FriendsPage request and failure states', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.from.mockImplementation((table: string) => {
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'or', 'in', 'ilike', 'neq', 'limit']) {
        builder[method] = vi.fn(() => builder);
      }
      builder.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve(
          table === 'friend_requests' ? { data: [], error: null } : { data: [], error: null }
        ).then(resolve);
      return builder;
    });
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    mocks.dbFrom.mockImplementation(() => ({
      update: mocks.update,
    }));
    mocks.update.mockImplementation(() => ({ eq: mocks.eq }));
    mocks.eq.mockImplementation(() => ({
      select: vi.fn(() => ({
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'request-1' }, error: null }),
      })),
    }));
  });

  it('shows a recoverable error instead of presenting failed reads as an empty friend list', async () => {
    mocks.from.mockImplementationOnce(() => {
      const builder: Record<string, unknown> = {};
      builder.select = vi.fn(() => builder);
      builder.or = vi.fn(() => ({
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: null, error: new Error('network unavailable') }).then(resolve),
      }));
      return builder;
    });

    renderPage();

    expect(await screen.findByText(/Could not load friends and balances/)).toBeTruthy();
    expect(screen.queryByText('No friends yet')).toBeNull();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('lets a user cancel an outgoing request', async () => {
    const rows = [
      {
        id: 'request-1',
        sender_id: 'current-user',
        receiver_id: 'other-user',
        status: 'pending',
        created_at: '2026-10-22T00:00:00.000Z',
      },
    ];
    mocks.from.mockImplementation((table: string) => {
      const builder: Record<string, unknown> = {};
      const result =
        table === 'friend_requests'
          ? { data: rows, error: null }
          : {
              data: [
                {
                  id: 'other-user',
                  username: 'other',
                  display_name: 'Other Person',
                  avatar_url: null,
                },
              ],
              error: null,
            };
      for (const method of ['select', 'or', 'in', 'ilike', 'neq', 'limit']) {
        builder[method] = vi.fn(() => builder);
      }
      builder.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve(result).then(resolve);
      return builder;
    });

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel request to Other Person' }));

    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith({ status: 'cancelled' }));
    expect(mocks.eq).toHaveBeenCalledWith('id', 'request-1');
  });
});
