import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthCallbackPage } from './AuthCallbackPage';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  resendVerificationEmail: vi.fn(),
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  verifyOtp: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  };
});

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    resendVerificationEmail: mocks.resendVerificationEmail,
  }),
}));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: mocks.getSession,
      onAuthStateChange: mocks.onAuthStateChange,
      verifyOtp: mocks.verifyOtp,
    },
  },
}));

function renderPage(initialEntries = ['/auth/callback']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <AuthCallbackPage />
    </MemoryRouter>
  );
}

describe('AuthCallbackPage token exchange, error recovery, and redirect safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    window.location.hash = '';
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });
    mocks.onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });
  });

  it('navigates immediately if a session is already established', async () => {
    mocks.getSession.mockResolvedValueOnce({
      data: { session: { user: { id: 'u1' } } },
      error: null,
    });

    renderPage();

    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith('/', { replace: true });
    });
  });

  it('preserves valid relative redirect destination', async () => {
    mocks.getSession.mockResolvedValueOnce({
      data: { session: { user: { id: 'u1' } } },
      error: null,
    });

    renderPage(['/auth/callback?redirect=%2Fgroups%2Fgroup-123']);

    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith('/groups/group-123', { replace: true });
    });
  });

  it('rejects external or protocol-relative redirect destinations and defaults to root', async () => {
    mocks.getSession.mockResolvedValueOnce({
      data: { session: { user: { id: 'u1' } } },
      error: null,
    });

    renderPage(['/auth/callback?redirect=https%3A%2F%2Fevil.com']);

    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith('/', { replace: true });
    });
  });

  it('rejects double-slash protocol-relative redirect destinations', async () => {
    mocks.getSession.mockResolvedValueOnce({
      data: { session: { user: { id: 'u1' } } },
      error: null,
    });

    renderPage(['/auth/callback?redirect=%2F%2Fevil.com']);

    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith('/', { replace: true });
    });
  });

  it('rejects backslash open-redirect destinations', async () => {
    mocks.getSession.mockResolvedValueOnce({
      data: { session: { user: { id: 'u1' } } },
      error: null,
    });

    renderPage(['/auth/callback?redirect=%2F%5Cevil.com']);

    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith('/', { replace: true });
    });
  });

  it('rejects unsupported OTP type parameter without calling verifyOtp', async () => {
    renderPage(['/auth/callback?token_hash=token123&type=unsupported_type']);

    expect(await screen.findByText(/invalid or unsupported verification type/i)).toBeTruthy();
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it('detects otp_expired error in searchParams and presents expired link recovery with resend', async () => {
    mocks.resendVerificationEmail.mockResolvedValueOnce({ error: null });

    renderPage([
      '/auth/callback?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
    ]);

    expect(
      await screen.findByText(/this email verification link has expired or has already been used/i)
    ).toBeTruthy();

    const input = screen.getByLabelText(/email address for verification/i);
    fireEvent.change(input, { target: { value: 'user@example.com' } });

    const submitBtn = screen.getByRole('button', { name: /send new link/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mocks.resendVerificationEmail).toHaveBeenCalledWith('user@example.com', undefined);
    });

    expect(await screen.findByText(/a new verification link has been sent!/i)).toBeTruthy();
  });

  it('detects error from hash fragment when redirected via hash', async () => {
    window.location.hash =
      '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired';

    renderPage(['/auth/callback']);

    expect(
      await screen.findByText(/this email verification link has expired or has already been used/i)
    ).toBeTruthy();
  });

  it('handles direct token_hash verification with verifyOtp successfully', async () => {
    mocks.verifyOtp.mockResolvedValueOnce({
      data: { session: { user: { id: 'verified-user' } } },
      error: null,
    });

    renderPage(['/auth/callback?token_hash=valid_hash_123&type=signup']);

    await waitFor(() => {
      expect(mocks.verifyOtp).toHaveBeenCalledWith({
        token_hash: 'valid_hash_123',
        type: 'signup',
      });
      expect(mocks.navigate).toHaveBeenCalledWith('/', { replace: true });
    });
  });

  it('navigates to /reset-password when token_hash has type=recovery', async () => {
    mocks.verifyOtp.mockResolvedValueOnce({
      data: { session: { user: { id: 'recovering-user' } } },
      error: null,
    });

    renderPage(['/auth/callback?token_hash=recovery_hash_123&type=recovery']);

    await waitFor(() => {
      expect(mocks.verifyOtp).toHaveBeenCalledWith({
        token_hash: 'recovery_hash_123',
        type: 'recovery',
      });
      expect(mocks.navigate).toHaveBeenCalledWith('/reset-password', { replace: true });
    });
  });

  it('displays recovery UI when verifyOtp fails with an expired token error', async () => {
    mocks.verifyOtp.mockResolvedValueOnce({
      data: { session: null },
      error: new Error('Token has expired or is invalid'),
    });

    renderPage(['/auth/callback?token_hash=expired_hash_123&type=signup']);

    expect(
      await screen.findByText(/this email verification link has expired or has already been used/i)
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: /send new link/i })).toBeTruthy();
  });

  it('navigates when onAuthStateChange fires SIGNED_IN event', async () => {
    let authListener!: (event: string, session: unknown) => void;
    mocks.onAuthStateChange.mockImplementationOnce((cb) => {
      authListener = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });

    renderPage(['/auth/callback?code=pkce_code_123']);

    expect(authListener).toBeDefined();
    authListener('SIGNED_IN', { user: { id: 'signed-in-user' } });

    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith('/', { replace: true });
    });
  });

  it('displays expired/cross-browser message when code exchange times out without session', async () => {
    vi.useFakeTimers();
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });

    renderPage(['/auth/callback?code=unresolvable_code']);

    await act(async () => {
      vi.advanceTimersByTime(6500);
    });

    expect(screen.getByText(/was opened in a different browser or has expired/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /send new link/i })).toBeTruthy();
    vi.useRealTimers();
  });
});
