import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EditExpensePage } from './EditExpensePage';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  dbFrom: vi.fn(),
  user: { id: 'owner-user' },
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: mocks.user }),
}));

vi.mock('../../lib/supabase', () => ({
  supabase: { from: mocks.from },
  db: { rpc: mocks.rpc, from: mocks.dbFrom },
}));

const expense = {
  id: 'expense-1',
  title: 'Dinner',
  amount_paise: 1000,
  expense_date: '2026-10-20',
  notes: null,
  category: null,
  split_method: 'equal',
  creator_id: 'owner-user',
  status: 'active',
  updated_at: '2026-10-21T10:00:00.000000+00:00',
  expense_payers: [{ user_id: 'owner-user', amount_paise: 1000 }],
  expense_shares: [
    { user_id: 'owner-user', amount_paise: 500, percentage: null, share_weight: null },
    { user_id: 'friend-user', amount_paise: 500, percentage: null, share_weight: null },
  ],
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/expenses/expense-1/edit']}>
      <Routes>
        <Route path="/expenses/:expenseId/edit" element={<EditExpensePage />} />
        <Route path="/expenses/:expenseId" element={<p>Expense saved</p>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('EditExpensePage atomic updates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.from.mockImplementation(() => {
      const builder: Record<string, unknown> = {};
      builder.select = vi.fn(() => builder);
      builder.eq = vi.fn(() => builder);
      builder.single = vi.fn().mockResolvedValue({ data: expense, error: null });
      return builder;
    });
  });

  it('saves header, payer, and share changes through the single atomic RPC', async () => {
    mocks.rpc.mockResolvedValue({ data: 'expense-1', error: null });
    renderPage();

    fireEvent.change(await screen.findByDisplayValue('10.00'), { target: { value: '12.00' } });
    fireEvent.change(screen.getByDisplayValue('Dinner'), { target: { value: 'Updated dinner' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith('update_expense_with_records', {
        p_expense_id: 'expense-1',
        p_expected_updated_at: expense.updated_at,
        p_title: 'Updated dinner',
        p_amount_paise: 1200,
        p_expense_date: '2026-10-20',
        p_notes: null,
        p_category: null,
      })
    );
    expect(mocks.dbFrom).not.toHaveBeenCalled();
    expect(await screen.findByText('Expense saved')).toBeTruthy();
  });

  it('keeps the editor open and reports stale-write conflicts without partial updates', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: '40001', message: 'stale write' },
    });
    renderPage();

    fireEvent.change(await screen.findByDisplayValue('Dinner'), {
      target: { value: 'Updated dinner' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText(/This expense changed while you were editing it/)).toBeTruthy();
    expect(screen.queryByText('Expense saved')).toBeNull();
    expect(mocks.dbFrom).not.toHaveBeenCalled();
  });
});
