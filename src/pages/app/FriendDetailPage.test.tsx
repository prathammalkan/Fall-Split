import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FriendDetailPage } from './FriendDetailPage';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  dbRpc: vi.fn(),
  user: { id: 'current-user-1' },
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: mocks.user }),
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

const mockFriendProfile = {
  id: 'friend-user-2',
  display_name: 'Bob Friend',
  username: 'bobfriend',
  avatar_url: null,
  bio: 'A good friend',
  upi_id: 'bob@upi',
};

function renderFriendDetail(friendId = 'friend-user-2') {
  return render(
    <MemoryRouter initialEntries={[`/friends/${friendId}`]}>
      <Routes>
        <Route path="/friends/:userId" element={<FriendDetailPage />} />
        <Route path="/settlements" element={<p>Settlements screen</p>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('FriendDetailPage Settlement & Balance Breakdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.dbRpc.mockImplementation((rpcName: string) => {
      if (rpcName === 'get_profile_for_user') {
        return Promise.resolve({ data: [mockFriendProfile], error: null });
      }
      if (rpcName === 'propose_settlement') {
        return Promise.resolve({ data: 'settlement-new-1', error: null });
      }
      if (rpcName === 'respond_to_settlement') {
        return Promise.resolve({ data: 'settlement-1', error: null });
      }
      if (rpcName === 'cancel_settlement') {
        return Promise.resolve({ data: 'settlement-1', error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });

    mocks.rpc.mockImplementation((rpcName: string) => {
      if (rpcName === 'get_friend_balances') {
        return Promise.resolve({
          data: [{ other_user_id: 'friend-user-2', net_paise: -50000 }], // user owes friend 500
          error: null,
        });
      }
      return Promise.resolve({ data: [], error: null });
    });

    mocks.from.mockImplementation((table: string) => {
      const builder: Record<string, unknown> = {};
      builder.select = vi.fn(() => builder);
      builder.or = vi.fn(() => builder);
      builder.in = vi.fn(() => builder);
      builder.is = vi.fn(() => builder);
      builder.order = vi.fn(() => builder);
      builder.limit = vi.fn(() => builder);
      builder.then = (resolve: (value: unknown) => unknown) => {
        if (table === 'settlements') {
          return Promise.resolve({ data: [], error: null }).then(resolve);
        }
        if (table === 'expenses') {
          return Promise.resolve({ data: [], error: null }).then(resolve);
        }
        return Promise.resolve({ data: [], error: null }).then(resolve);
      };
      return builder;
    });
  });

  it('renders confirmed balance and official ledger notice', async () => {
    renderFriendDetail();
    expect(await screen.findByRole('heading', { name: 'Bob Friend' })).toBeTruthy();
    expect(screen.getByText('Confirmed Balance')).toBeTruthy();
    expect(screen.getByText('₹500.00')).toBeTruthy();
    expect(
      screen.getByText(
        'Official ledger balance based on confirmed expenses and accepted settlements.'
      )
    ).toBeTruthy();
  });

  it('Requirement D1 & D2: shows 2-step settlement confirmation and reported payment notice', async () => {
    renderFriendDetail();
    const settleBtn = await screen.findByRole('button', { name: /Settle up/i });
    fireEvent.click(settleBtn);

    // Enter amount in step 1
    const amountInput = screen.getByLabelText('Settlement amount in rupees');
    expect(amountInput).toBeTruthy();
    fireEvent.change(amountInput, { target: { value: '500' } });

    const continueBtn = screen.getByRole('button', { name: 'Continue' });
    fireEvent.click(continueBtn);

    // Step 2: D1 Confirmation Dialog appears
    expect(await screen.findByText('Confirm payment details')).toBeTruthy();
    expect(
      screen.getByText(
        /This will notify Bob Friend to confirm receipt\. Your balance will update once they confirm\./i
      )
    ).toBeTruthy();

    const confirmAndSendBtn = screen.getByRole('button', { name: /Confirm & Send Notice/i });
    fireEvent.click(confirmAndSendBtn);

    // D2: Reported Notice appears
    await waitFor(() => {
      expect(mocks.dbRpc).toHaveBeenCalledWith(
        'propose_settlement',
        expect.objectContaining({
          p_recipient_id: 'friend-user-2',
          p_amount_paise: 50000,
        })
      );
    });

    expect(await screen.findByText('Payment reported')).toBeTruthy();
    expect(
      screen.getByText(
        /Payment of ₹500\.00 reported to Bob Friend\. Awaiting their confirmation\./i
      )
    ).toBeTruthy();
  });

  it('Requirement D3: recipient can confirm or reject incoming reported payment', async () => {
    mocks.from.mockImplementation((table: string) => {
      const builder: Record<string, unknown> = {};
      builder.select = vi.fn(() => builder);
      builder.or = vi.fn(() => builder);
      builder.in = vi.fn(() => builder);
      builder.is = vi.fn(() => builder);
      builder.order = vi.fn(() => builder);
      builder.limit = vi.fn(() => builder);
      builder.then = (resolve: (value: unknown) => unknown) => {
        if (table === 'settlements') {
          return Promise.resolve({
            data: [
              {
                id: 'settlement-incoming-1',
                payer_id: 'friend-user-2',
                recipient_id: 'current-user-1',
                amount_paise: 25000,
                status: 'proposed',
                created_at: new Date().toISOString(),
              },
            ],
            error: null,
          }).then(resolve);
        }
        return Promise.resolve({ data: [], error: null }).then(resolve);
      };
      return builder;
    });

    renderFriendDetail();
    expect(await screen.findByText('Bob Friend reported paying you.')).toBeTruthy();
    const confirmReceiptBtn = screen.getByRole('button', { name: /Confirm Receipt/i });
    const notReceivedBtn = screen.getByRole('button', { name: /Not Received/i });

    expect(confirmReceiptBtn).toBeTruthy();
    expect(notReceivedBtn).toBeTruthy();

    fireEvent.click(confirmReceiptBtn);
    await waitFor(() => {
      expect(mocks.dbRpc).toHaveBeenCalledWith('respond_to_settlement', {
        p_settlement_id: 'settlement-incoming-1',
        p_action: 'confirm',
      });
    });
  });

  it('Requirement F: renders transparent breakdown distinguishing in-flight items from ledger balance', async () => {
    mocks.from.mockImplementation((table: string) => {
      const builder: Record<string, unknown> = {};
      builder.select = vi.fn(() => builder);
      builder.or = vi.fn(() => builder);
      builder.in = vi.fn(() => builder);
      builder.is = vi.fn(() => builder);
      builder.order = vi.fn(() => builder);
      builder.limit = vi.fn(() => builder);
      builder.then = (resolve: (value: unknown) => unknown) => {
        if (table === 'settlements') {
          return Promise.resolve({
            data: [
              {
                id: 'settlement-incoming-1',
                payer_id: 'friend-user-2',
                recipient_id: 'current-user-1',
                amount_paise: 25000,
                status: 'proposed',
                created_at: new Date().toISOString(),
              },
            ],
            error: null,
          }).then(resolve);
        }
        return Promise.resolve({ data: [], error: null }).then(resolve);
      };
      return builder;
    });

    renderFriendDetail();
    expect(await screen.findByText('In-Flight & Pending Breakdown')).toBeTruthy();
    expect(screen.getByText('Reported settlements')).toBeTruthy();
    expect(
      screen.getByText(
        'All pending items remain separate from your official ledger until confirmed by both parties.'
      )
    ).toBeTruthy();
  });
});
