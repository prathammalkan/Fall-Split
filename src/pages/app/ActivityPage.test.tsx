import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ActivityPage } from './ActivityPage';

const mocks = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'current-user' } }),
}));

vi.mock('../../lib/supabase', () => ({ supabase: { from: mocks.from } }));

describe('ActivityPage', () => {
  it('shows a recoverable error rather than an empty activity state when reads fail', async () => {
    mocks.from.mockImplementation(() => {
      const builder: Record<string, unknown> = {};
      builder.select = vi.fn(() => builder);
      builder.eq = vi.fn(() => builder);
      builder.order = vi.fn(() => builder);
      builder.limit = vi.fn(() => builder);
      builder.or = vi.fn(() => builder);
      builder.in = vi.fn(() => builder);
      builder.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: null, error: new Error('network unavailable') }).then(resolve);
      return builder;
    });

    render(
      <MemoryRouter>
        <ActivityPage />
      </MemoryRouter>
    );

    expect(await screen.findByText(/Activity could not be loaded/)).toBeTruthy();
    expect(screen.queryByText('No activity yet')).toBeNull();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('renders confirmed expenses and queries with bounded 50-record limit', async () => {
    const limitSpy = vi.fn();
    mocks.from.mockImplementation((table: string) => {
      const builder: Record<string, unknown> = {};
      builder.select = vi.fn(() => builder);
      builder.eq = vi.fn(() => builder);
      builder.order = vi.fn(() => builder);
      builder.limit = vi.fn((n: number) => {
        limitSpy(table, n);
        return builder;
      });
      builder.or = vi.fn(() => builder);
      builder.in = vi.fn(() => builder);
      builder.then = (resolve: (value: unknown) => unknown) => {
        if (table === 'expense_payers') {
          return Promise.resolve({
            data: [
              {
                expense_id: 'exp-1',
                amount_paise: 5000,
                expenses: {
                  id: 'exp-1',
                  title: 'Team Lunch',
                  amount_paise: 5000,
                  expense_date: '2026-10-24',
                  status: 'confirmed',
                },
              },
            ],
            error: null,
          }).then(resolve);
        }
        if (table === 'expense_shares') {
          return Promise.resolve({ data: [], error: null }).then(resolve);
        }
        if (table === 'settlements') {
          return Promise.resolve({ data: [], error: null }).then(resolve);
        }
        return Promise.resolve({ data: [], error: null }).then(resolve);
      };
      return builder;
    });

    render(
      <MemoryRouter>
        <ActivityPage />
      </MemoryRouter>
    );

    expect(await screen.findByText('Team Lunch')).toBeTruthy();
    expect(limitSpy).toHaveBeenCalledWith('expense_payers', 50);
    expect(limitSpy).toHaveBeenCalledWith('expense_shares', 50);
    expect(limitSpy).toHaveBeenCalledWith('settlements', 50);
  });

  it('indicates partial history when queries reach limit and allows loading more', async () => {
    // 50 records from settlements
    const fiftySettlements = Array.from({ length: 50 }, (_, i) => ({
      id: `settle-${i}`,
      payer_id: 'current-user',
      recipient_id: 'other-user',
      amount_paise: 1000,
      status: 'confirmed',
      created_at: '2026-10-24T10:00:00Z',
      notes: null,
    }));

    mocks.from.mockImplementation((table: string) => {
      const builder: Record<string, unknown> = {};
      builder.select = vi.fn(() => builder);
      builder.eq = vi.fn(() => builder);
      builder.order = vi.fn(() => builder);
      builder.limit = vi.fn(() => builder);
      builder.or = vi.fn(() => builder);
      builder.in = vi.fn(() => builder);
      builder.then = (resolve: (value: unknown) => unknown) => {
        if (table === 'settlements') {
          return Promise.resolve({ data: fiftySettlements, error: null }).then(resolve);
        }
        return Promise.resolve({ data: [], error: null }).then(resolve);
      };
      return builder;
    });

    render(
      <MemoryRouter>
        <ActivityPage />
      </MemoryRouter>
    );

    expect(await screen.findByText(/Showing recent activity. Older records exist./)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Load older activity' })).toBeTruthy();
  });

  it('reconciles omitted payer records when expense was only retrieved in share query', async () => {
    mocks.from.mockImplementation((table: string) => {
      const builder: Record<string, unknown> = {};
      let inValues: string[] = [];
      builder.select = vi.fn(() => builder);
      builder.eq = vi.fn(() => builder);
      builder.order = vi.fn(() => builder);
      builder.limit = vi.fn(() => builder);
      builder.or = vi.fn(() => builder);
      builder.in = vi.fn((_col: string, vals: string[]) => {
        inValues = vals;
        return builder;
      });
      builder.then = (resolve: (value: unknown) => unknown) => {
        if (table === 'expense_payers') {
          // If called with .in('expense_id', ...), return the missing payer record
          if (inValues.includes('exp-shared-only')) {
            return Promise.resolve({
              data: [{ expense_id: 'exp-shared-only' }],
              error: null,
            }).then(resolve);
          }
          // Initial query returns empty
          return Promise.resolve({ data: [], error: null }).then(resolve);
        }
        if (table === 'expense_shares') {
          return Promise.resolve({
            data: [
              {
                expense_id: 'exp-shared-only',
                amount_paise: 2500,
                expenses: {
                  id: 'exp-shared-only',
                  title: 'Shared Dinner',
                  amount_paise: 2500,
                  expense_date: '2026-10-24',
                  status: 'confirmed',
                },
              },
            ],
            error: null,
          }).then(resolve);
        }
        return Promise.resolve({ data: [], error: null }).then(resolve);
      };
      return builder;
    });

    render(
      <MemoryRouter>
        <ActivityPage />
      </MemoryRouter>
    );

    expect(await screen.findByText('Shared Dinner')).toBeTruthy();
    // User is identified as payer via reconciled query, so amount is positive (+)
    const amountEl = screen.getByText(/\+₹25/);
    expect(amountEl.className).toContain('amount-positive');
  });
});
