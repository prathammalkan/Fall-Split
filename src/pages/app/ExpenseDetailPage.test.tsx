import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExpenseDetailPage } from './ExpenseDetailPage';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  dbFrom: vi.fn(),
  user: { id: 'owner-user' } as { id: string } | null,
  removeOperationsForExpense: vi.fn(),
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: mocks.user }),
}));

vi.mock('../../lib/supabase', () => ({
  supabase: { from: mocks.from },
  db: { rpc: mocks.rpc, from: mocks.dbFrom },
}));

vi.mock('../../lib/offlineQueue', () => ({
  removeOperationsForExpense: (...args: unknown[]) => mocks.removeOperationsForExpense(...args),
}));

const expenseData = {
  id: 'expense-1',
  title: 'Dinner at Taj',
  description: 'Team dinner',
  amount_paise: 250000,
  currency: 'INR',
  split_method: 'equal',
  expense_date: '2026-10-22',
  created_at: '2026-10-22T12:00:00.000Z',
  category: 'Food & Drink',
  notes: 'All items paid in cash',
  status: 'active',
  creator_id: 'owner-user',
  creator: { display_name: 'Owner Alice' },
  group: { id: 'group-1', name: 'Goa Trip' },
  expense_payers: [
    {
      user_id: 'owner-user',
      amount_paise: 250000,
      profile: { display_name: 'Owner Alice', avatar_url: null },
    },
  ],
  expense_shares: [
    {
      user_id: 'owner-user',
      amount_paise: 125000,
      percentage: null,
      share_weight: null,
      profile: { display_name: 'Owner Alice', avatar_url: null },
    },
    {
      user_id: 'friend-bob',
      amount_paise: 125000,
      percentage: null,
      share_weight: null,
      profile: { display_name: 'Friend Bob', avatar_url: null },
    },
  ],
};

function renderPage(initialEntry = '/expenses/expense-1') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/expenses/:expenseId" element={<ExpenseDetailPage />} />
        <Route path="/groups/:groupId" element={<p>Group details screen</p>} />
        <Route path="/activity" element={<p>Activity screen</p>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('ExpenseDetailPage owner-only deletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user = { id: 'owner-user' };
    mocks.from.mockImplementation(() => {
      const builder: Record<string, unknown> = {};
      builder.select = vi.fn(() => builder);
      builder.eq = vi.fn(() => builder);
      builder.neq = vi.fn(() => builder);
      builder.single = vi.fn().mockResolvedValue({ data: expenseData, error: null });
      return builder;
    });
    mocks.rpc.mockResolvedValue({ data: 'expense-1', error: null });
  });

  it('shows Delete action only to the verified creator', async () => {
    renderPage();
    expect(await screen.findByRole('button', { name: 'Delete expense' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Edit expense' })).toBeTruthy();
  });

  it('hides Delete and Edit actions from participants who are not the creator', async () => {
    mocks.user = { id: 'friend-bob' };
    renderPage();

    await screen.findByText('Dinner at Taj');
    expect(screen.queryByRole('button', { name: 'Delete expense' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Edit expense' })).toBeNull();
  });

  it('hides Delete and Edit actions from unauthenticated visitors', async () => {
    mocks.user = null;
    renderPage();

    await screen.findByText('Dinner at Taj');
    expect(screen.queryByRole('button', { name: 'Delete expense' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Edit expense' })).toBeNull();
  });

  it('hides Delete action if the expense is not active', async () => {
    mocks.from.mockImplementation(() => {
      const builder: Record<string, unknown> = {};
      builder.select = vi.fn(() => builder);
      builder.eq = vi.fn(() => builder);
      builder.neq = vi.fn(() => builder);
      builder.single = vi.fn().mockResolvedValue({
        data: { ...expenseData, status: 'voided' },
        error: null,
      });
      return builder;
    });
    renderPage();

    await screen.findByText('Dinner at Taj');
    expect(screen.queryByRole('button', { name: 'Delete expense' })).toBeNull();
  });

  it('requires explicit confirmation clearly identifying the expense and allows cancellation', async () => {
    renderPage();

    const deleteBtn = await screen.findByRole('button', { name: 'Delete expense' });
    fireEvent.click(deleteBtn);

    // Confirmation dialog appears with exact title and formatted amount
    expect(screen.getByText(/Delete “Dinner at Taj” \(₹2,500\.00\)\?/)).toBeTruthy();
    expect(screen.getByRole('alertdialog')).toBeTruthy();

    // Cancel leaves the expense untouched
    const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
    fireEvent.click(cancelBtn);

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.removeOperationsForExpense).not.toHaveBeenCalled();
  });

  it('executes owner deletion via secure RPC, cleans offline queue, and navigates', async () => {
    renderPage();

    const deleteBtn = await screen.findByRole('button', { name: 'Delete expense' });
    fireEvent.click(deleteBtn);

    const confirmDeleteBtn = screen.getByRole('button', { name: 'Delete' });
    fireEvent.click(confirmDeleteBtn);

    await waitFor(() => {
      expect(mocks.rpc).toHaveBeenCalledWith('delete_expense', {
        p_expense_id: 'expense-1',
      });
    });

    await waitFor(() => {
      expect(mocks.removeOperationsForExpense).toHaveBeenCalledWith('expense-1', 'owner-user');
    });

    expect(await screen.findByText('Group details screen')).toBeTruthy();
  });

  it('prevents repeated submission while deletion is in progress', async () => {
    let resolveRpc: (value: unknown) => void = () => {};
    mocks.rpc.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRpc = resolve;
        })
    );

    renderPage();
    const deleteBtn = await screen.findByRole('button', { name: 'Delete expense' });
    fireEvent.click(deleteBtn);

    const confirmDeleteBtn = screen.getByRole('button', { name: 'Delete' });
    fireEvent.click(confirmDeleteBtn);

    // Both buttons disabled while in flight
    expect(confirmDeleteBtn.getAttribute('disabled')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel' }).getAttribute('disabled')).not.toBeNull();

    // Repeated clicks do nothing
    fireEvent.click(confirmDeleteBtn);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);

    // Complete deletion
    resolveRpc({ data: 'expense-1', error: null });
    await waitFor(() => {
      expect(mocks.removeOperationsForExpense).toHaveBeenCalledWith('expense-1', 'owner-user');
    });
  });

  it('handles backend rejection safely: keeps expense in view and displays error message', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        message: 'Cannot delete expense while a related settlement is pending confirmation',
      },
    });

    renderPage();
    const deleteBtn = await screen.findByRole('button', { name: 'Delete expense' });
    fireEvent.click(deleteBtn);

    const confirmDeleteBtn = screen.getByRole('button', { name: 'Delete' });
    fireEvent.click(confirmDeleteBtn);

    // Error is displayed and expense remains in view
    expect(
      await screen.findByText(
        'Cannot delete expense while a related settlement is pending confirmation'
      )
    ).toBeTruthy();
    expect(screen.getByText('Dinner at Taj')).toBeTruthy();
    expect(mocks.removeOperationsForExpense).not.toHaveBeenCalled();
    expect(screen.queryByText('Group details screen')).toBeNull();
  });

  it('requires a dispute reason of at least 3 characters before submitting dispute', async () => {
    // Current user is participant Bob (not creator)
    mocks.user = { id: 'other-user' };
    const mockExpenseWithApprovals = {
      ...expenseData,
      status: 'pending_approval',
    };

    mocks.from.mockImplementation((table: string) => {
      const builder: Record<string, unknown> = {};
      builder.select = vi.fn(() => builder);
      builder.eq = vi.fn(() => builder);
      builder.neq = vi.fn(() => builder);
      builder.single = vi.fn(() =>
        Promise.resolve({ data: mockExpenseWithApprovals, error: null })
      );
      builder.then = (resolve: (value: unknown) => unknown) => {
        if (table === 'expense_approvals') {
          return Promise.resolve({
            data: [
              {
                id: 'app-1',
                user_id: 'other-user',
                status: 'pending',
                dispute_reason: null,
                dispute_category: null,
                created_at: '2026-10-22',
                responded_at: null,
                profile: { display_name: 'Other Bob', avatar_url: null },
              },
            ],
            error: null,
          }).then(resolve);
        }
        return Promise.resolve({ data: [], error: null }).then(resolve);
      };
      return builder;
    });

    renderPage();

    const disputeBtn = await screen.findByRole('button', { name: /Dispute/i });
    fireEvent.click(disputeBtn);

    // Dispute modal is open
    expect(await screen.findByRole('dialog', { name: 'Dispute expense' })).toBeTruthy();
    const submitDisputeBtn = screen.getByRole('button', { name: 'Submit dispute' });

    // Disabled initially because reason is empty
    expect(submitDisputeBtn.hasAttribute('disabled')).toBe(true);

    const reasonInput = screen.getByPlaceholderText(/Explain what needs to be corrected/i);
    fireEvent.change(reasonInput, { target: { value: 'No' } });
    expect(submitDisputeBtn.hasAttribute('disabled')).toBe(true);

    fireEvent.change(reasonInput, { target: { value: 'Amount is incorrect for my share' } });
    expect(submitDisputeBtn.hasAttribute('disabled')).toBe(false);

    mocks.rpc.mockResolvedValue({ data: { success: true }, error: null });
    fireEvent.click(submitDisputeBtn);

    await waitFor(() => {
      expect(mocks.rpc).toHaveBeenCalledWith('respond_to_expense_approval', {
        p_expense_id: 'expense-1',
        p_action: 'dispute',
        p_dispute_category: 'Incorrect personal share',
        p_dispute_reason: 'Amount is incorrect for my share',
      });
    });
  });
});
