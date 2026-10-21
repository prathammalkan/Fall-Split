import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { db } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { InvitePage } from './InvitePage';

vi.mock('../../context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

const token = 'a'.repeat(64);
const mockRpc = vi.mocked(db.rpc);
const mockUseAuth = vi.mocked(useAuth);

function renderInvite() {
  return render(
    <MemoryRouter initialEntries={[`/invite/${token}`]}>
      <Routes>
        <Route path="/invite/:token" element={<InvitePage />} />
        <Route path="/groups/:groupId" element={<p>Group joined</p>} />
        <Route path="/friends" element={<p>Friends page</p>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('InvitePage', () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockUseAuth.mockReturnValue({ user: null } as ReturnType<typeof useAuth>);
  });

  it('previews a friend invite before sign-in and preserves it in auth links', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { type: 'friend', creator_name: 'Riya' },
      error: null,
    } as never);

    renderInvite();

    const inviter = await screen.findByText('Riya');
    expect(inviter.parentElement?.textContent).toContain('invited you');
    expect(screen.getByRole('link', { name: 'Sign in to accept' }).getAttribute('href')).toBe(
      `/login?redirect=${encodeURIComponent(`/invite/${token}`)}`
    );
    expect(screen.getByRole('link', { name: 'Create an account' }).getAttribute('href')).toBe(
      `/register?redirect=${encodeURIComponent(`/invite/${token}`)}`
    );
    expect(mockRpc).toHaveBeenCalledWith('get_invitation_preview', { p_token: token });
  });

  it('shows an unavailable message for an expired or invalid invitation', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null } as never);

    renderInvite();

    expect(await screen.findByText(/invalid, expired, revoked, or has reached/i)).toBeTruthy();
  });

  it('accepts the invitation using the authenticated RPC', async () => {
    mockUseAuth.mockReturnValue({ user: { id: 'user-1' } } as ReturnType<typeof useAuth>);
    mockRpc
      .mockResolvedValueOnce({
        data: { type: 'group', creator_name: 'Riya' },
        error: null,
      } as never)
      .mockResolvedValueOnce({
        data: { success: true, type: 'group', groupId: 'group-1' },
        error: null,
      } as never);

    renderInvite();
    fireEvent.click(await screen.findByRole('button', { name: 'Accept invitation' }));

    await waitFor(() => {
      expect(mockRpc).toHaveBeenLastCalledWith('accept_invitation', { p_token: token });
    });
    expect(await screen.findByText("You're connected!")).toBeTruthy();
  });
});
