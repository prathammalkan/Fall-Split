import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HomePage } from './HomePage';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  dbRpc: vi.fn(),
  user: { id: 'current-user-1' },
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: mocks.user, emailVerified: true }),
}));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: mocks.from,
    rpc: mocks.rpc,
  },
  db: {
    rpc: mocks.dbRpc,
  },
}));

function createQueryBuilder(resultData: unknown) {
  const b: Record<string, unknown> = {};
  b.select = vi.fn(() => b);
  b.in = vi.fn(() => b);
  b.or = vi.fn(() => b);
  b.eq = vi.fn(() => b);
  b.is = vi.fn(() => b);
  b.order = vi.fn(() => b);
  b.limit = vi.fn(() => b);
  b.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: resultData, error: null }).then(resolve);
  return b;
}

function renderHomePage() {
  return render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>
  );
}

describe('HomePage Pending Actions & Balance Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.rpc.mockResolvedValue({
      data: [{ other_user_id: 'friend-alice', net_paise: -35000 }],
      error: null,
    });

    mocks.from.mockImplementation((table: string) => {
      if (table === 'discoverable_profiles') {
        return createQueryBuilder([
          {
            id: 'friend-alice',
            username: 'alice',
            display_name: 'Alice Wonder',
            avatar_url: null,
          },
        ]);
      }
      if (table === 'notifications') {
        const b = createQueryBuilder([]);
        b.then = (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ count: 0, error: null }).then(resolve);
        return b;
      }
      return createQueryBuilder([]);
    });
  });

  it('renders all caught up message in Pending Actions when no approvals or settlements are pending', async () => {
    renderHomePage();
    expect(
      await screen.findByText('All caught up! No pending approvals or settlements.')
    ).toBeTruthy();
    expect(screen.getByText('Pending Actions')).toBeTruthy();
    expect(screen.getByText('Alice Wonder')).toBeTruthy();
  });

  it('surfaces pending actions: approvals, incoming settlements, and disputes', async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table === 'discoverable_profiles') {
        return createQueryBuilder([
          {
            id: 'friend-alice',
            username: 'alice',
            display_name: 'Alice Wonder',
            avatar_url: null,
          },
        ]);
      }
      if (table === 'notifications') {
        const b = createQueryBuilder([]);
        b.then = (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ count: 0, error: null }).then(resolve);
        return b;
      }
      if (table === 'settlements') {
        return createQueryBuilder([
          {
            id: 'settlement-incoming-99',
            payer_id: 'friend-alice',
            recipient_id: 'current-user-1',
            amount_paise: 15000,
            created_at: new Date().toISOString(),
            status: 'proposed',
            payer: { display_name: 'Alice Wonder' },
            recipient: { display_name: 'Me' },
          },
        ]);
      }
      if (table === 'expense_approvals') {
        return createQueryBuilder([
          {
            id: 'approval-1',
            expense_id: 'expense-lunch',
            status: 'pending',
            created_at: new Date().toISOString(),
            expenses: {
              id: 'expense-lunch',
              title: 'Team Lunch',
              amount_paise: 80000,
              creator_id: 'friend-alice',
              creator: { display_name: 'Alice Wonder' },
            },
          },
        ]);
      }
      if (table === 'expenses') {
        let statusFilter = '';
        const b = createQueryBuilder([]);
        b.eq = vi.fn((col: string, val: string) => {
          if (col === 'status') statusFilter = val;
          return b;
        });
        b.then = (resolve: (v: unknown) => unknown) => {
          if (statusFilter === 'pending_approval') {
            return Promise.resolve({
              data: [
                {
                  id: 'expense-submitted-1',
                  title: 'Movie Night',
                  amount_paise: 60000,
                  created_at: new Date().toISOString(),
                  status: 'pending_approval',
                  approvals: [{ id: 'app-1', status: 'approved' }],
                },
              ],
              error: null,
            }).then(resolve);
          }
          if (statusFilter === 'disputed') {
            return Promise.resolve({
              data: [
                {
                  id: 'expense-disputed-1',
                  title: 'Weekend Cab',
                  amount_paise: 40000,
                  created_at: new Date().toISOString(),
                  status: 'disputed',
                  approvals: [{ dispute_category: 'Wrong share', dispute_reason: 'Too high' }],
                },
              ],
              error: null,
            }).then(resolve);
          }
          return Promise.resolve({ data: [], error: null }).then(resolve);
        };
        return b;
      }
      return createQueryBuilder([]);
    });

    renderHomePage();

    // 1. Expense awaiting approval
    expect(await screen.findByText('Team Lunch')).toBeTruthy();
    expect(screen.getByText(/Awaiting your approval/i)).toBeTruthy();

    // 2. Incoming settlement with quick response buttons
    expect(screen.getByText(/Alice Wonder reported paying you ₹150\.00/i)).toBeTruthy();
    const confirmBtn = screen.getByRole('button', { name: /Confirm Receipt/i });
    expect(confirmBtn).toBeTruthy();

    // 3. Disputed expense
    expect(screen.getByText('Weekend Cab')).toBeTruthy();
    expect(screen.getByText(/Issue: Wrong share/i)).toBeTruthy();

    // 4. Submitted expense
    expect(screen.getByText('Movie Night')).toBeTruthy();

    // Respond to incoming settlement
    fireEvent.click(confirmBtn);
    await waitFor(() => {
      expect(mocks.dbRpc).toHaveBeenCalledWith('respond_to_settlement', {
        p_settlement_id: 'settlement-incoming-99',
        p_action: 'confirm',
      });
    });
  });
});
