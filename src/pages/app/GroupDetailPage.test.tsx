import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GroupDetailPage } from './GroupDetailPage';

const mocks = vi.hoisted(() => ({
  user: { id: 'admin-user-id' },
  from: vi.fn(),
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: mocks.user }),
}));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: mocks.from,
  },
  db: {
    from: mocks.from,
  },
}));

vi.mock('../../components/ui/ShareInviteModal', () => ({
  ShareInviteModal: ({
    onClose,
    groupId,
    type,
  }: {
    onClose: () => void;
    groupId?: string;
    type?: string;
  }) => (
    <div data-testid="share-invite-modal" data-group-id={groupId} data-type={type}>
      <button onClick={onClose}>Close modal</button>
    </div>
  ),
}));

function renderPage(groupId = 'group-100') {
  return render(
    <MemoryRouter initialEntries={[`/groups/${groupId}`]}>
      <Routes>
        <Route path="/groups/:groupId" element={<GroupDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('GroupDetailPage', () => {
  const sampleGroup = {
    id: 'group-100',
    name: 'Trip to Manali',
    description: 'Mountains and chill',
    type: 'trip',
    creator_id: 'admin-user-id',
    created_at: new Date().toISOString(),
  };

  const sampleMembers = [
    {
      user_id: 'admin-user-id',
      role: 'admin',
      profile: {
        id: 'admin-user-id',
        display_name: 'Admin User',
        avatar_url: null,
        username: 'admin',
      },
    },
    {
      user_id: 'member-user-id',
      role: 'member',
      profile: {
        id: 'member-user-id',
        display_name: 'Regular Member',
        avatar_url: null,
        username: 'member',
      },
    },
  ];

  const sampleExpenses = [
    {
      id: 'exp-1',
      title: 'Cab ride',
      amount_paise: 150000,
      expense_date: '2026-10-20',
      status: 'confirmed',
    },
    {
      id: 'exp-2',
      title: 'Dinner buffet',
      amount_paise: 250000,
      expense_date: '2026-10-21',
      status: 'pending_approval',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user = { id: 'admin-user-id' };

    mocks.from.mockImplementation((table: string) => {
      if (table === 'groups') {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: sampleGroup, error: null }),
            }),
          }),
        };
      }
      if (table === 'group_members') {
        return {
          select: () => ({
            eq: () => ({
              is: () => Promise.resolve({ data: sampleMembers, error: null }),
            }),
          }),
        };
      }
      if (table === 'expenses') {
        return {
          select: () => ({
            eq: () => ({
              in: () => ({
                order: () => ({
                  limit: () => Promise.resolve({ data: sampleExpenses, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) };
    });
  });

  it('renders group details, member count, and confirmed ledger vs pending breakdown', async () => {
    renderPage();

    expect(await screen.findByText('Trip to Manali')).toBeTruthy();
    expect(screen.getByText('Mountains and chill')).toBeTruthy();
    expect(screen.getByText('Members (2)')).toBeTruthy();
    expect(screen.getByText('Admin User')).toBeTruthy();
    expect(screen.getByText('Regular Member')).toBeTruthy();

    // Confirmed ledger
    expect(screen.getByText('Confirmed group expenses')).toBeTruthy();
    expect(screen.getAllByText('₹1,500.00')).toHaveLength(2);

    // In-Flight breakdown
    expect(screen.getByText('In-Flight & Pending Breakdown')).toBeTruthy();
    expect(screen.getByText(/1 expense awaiting participant approval/)).toBeTruthy();

    // Expenses list
    expect(screen.getByText('Cab ride')).toBeTruthy();
    expect(screen.getByText('Dinner buffet')).toBeTruthy();
    expect(screen.getByText('Pending approval')).toBeTruthy();
  });

  it('shows Invite button to group admin and opens group ShareInviteModal', async () => {
    renderPage();

    const inviteBtn = await screen.findByRole('button', { name: 'Invite to group' });
    expect(inviteBtn).toBeTruthy();

    fireEvent.click(inviteBtn);

    const modal = await screen.findByTestId('share-invite-modal');
    expect(modal).toBeTruthy();
    expect(modal.getAttribute('data-group-id')).toBe('group-100');
    expect(modal.getAttribute('data-type')).toBe('group');

    fireEvent.click(screen.getByText('Close modal'));
    await waitFor(() => expect(screen.queryByTestId('share-invite-modal')).toBeNull());
  });

  it('does not show Invite button to non-admin member', async () => {
    mocks.user = { id: 'member-user-id' };
    renderPage();

    await screen.findByText('Trip to Manali');
    expect(screen.queryByRole('button', { name: 'Invite to group' })).toBeNull();
  });

  it('shows recoverable error state when group details fail to load', async () => {
    mocks.from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: null, error: new Error('Network error') }),
        }),
      }),
    }));

    renderPage();

    expect(await screen.findByText(/Group details could not be loaded/)).toBeTruthy();
  });
});
