import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RegisterPage } from './RegisterPage';

const mocks = vi.hoisted(() => ({
  signUp: vi.fn(),
  resendVerificationEmail: vi.fn(),
  navigate: vi.fn(),
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
    signUp: mocks.signUp,
    resendVerificationEmail: mocks.resendVerificationEmail,
  }),
}));

function renderPage(initialEntries = ['/register']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <RegisterPage />
    </MemoryRouter>
  );
}

describe('RegisterPage registration flow and confirmation UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it('restores cooldown from sessionStorage preventing bypass via remounting', async () => {
    sessionStorage.setItem('fs_reg_resend_cd', String(Date.now() + 45 * 1000));
    mocks.signUp.mockResolvedValueOnce({ error: null });

    renderPage();

    fireEvent.change(screen.getByLabelText(/^Name$/i), { target: { value: 'Jane Doe' } });
    fireEvent.change(screen.getByLabelText(/^Email$/i), { target: { value: 'jane@example.com' } });
    fireEvent.change(screen.getByLabelText(/^Password$/i), { target: { value: 'Secret123' } });
    fireEvent.change(screen.getByLabelText(/^Confirm Password$/i), {
      target: { value: 'Secret123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByText(/resend in/i)).toBeTruthy();
    expect((screen.getByRole('button', { name: /resend in/i }) as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  it('renders registration form and submits successfully requiring confirmation', async () => {
    mocks.signUp.mockResolvedValueOnce({ error: null });

    renderPage();

    fireEvent.change(screen.getByLabelText(/^Name$/i), { target: { value: 'Jane Doe' } });
    fireEvent.change(screen.getByLabelText(/^Email$/i), { target: { value: 'jane@example.com' } });
    fireEvent.change(screen.getByLabelText(/^Password$/i), { target: { value: 'Secret123' } });
    fireEvent.change(screen.getByLabelText(/^Confirm Password$/i), {
      target: { value: 'Secret123' },
    });

    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(mocks.signUp).toHaveBeenCalledWith('jane@example.com', 'Secret123', 'Jane Doe', '/');
    });

    // Confirmation pending screen should be visible
    expect(await screen.findByRole('heading', { name: /verify your email/i })).toBeTruthy();
    expect(screen.getByText('jane@example.com')).toBeTruthy();
    expect(screen.getByText(/check your spam or junk folder/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /resend verification email/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /back to sign in/i })).toBeTruthy();
  });

  it('handles resending verification email with success and cooldown', async () => {
    mocks.signUp.mockResolvedValueOnce({ error: null });
    mocks.resendVerificationEmail.mockResolvedValueOnce({ error: null });

    renderPage();

    fireEvent.change(screen.getByLabelText(/^Name$/i), { target: { value: 'Jane Doe' } });
    fireEvent.change(screen.getByLabelText(/^Email$/i), { target: { value: 'jane@example.com' } });
    fireEvent.change(screen.getByLabelText(/^Password$/i), { target: { value: 'Secret123' } });
    fireEvent.change(screen.getByLabelText(/^Confirm Password$/i), {
      target: { value: 'Secret123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    const resendBtn = await screen.findByRole('button', { name: /resend verification email/i });
    fireEvent.click(resendBtn);

    await waitFor(() => {
      expect(mocks.resendVerificationEmail).toHaveBeenCalledWith('jane@example.com', undefined);
    });

    expect(await screen.findByText(/verification link resent!/i)).toBeTruthy();
    expect(screen.getByText(/resend in/i)).toBeTruthy();
  });

  it('handles rate-limiting when resending verification email', async () => {
    mocks.signUp.mockResolvedValueOnce({ error: null });
    mocks.resendVerificationEmail.mockResolvedValueOnce({
      error: new Error('Email rate limit exceeded (429)'),
    });

    renderPage();

    fireEvent.change(screen.getByLabelText(/^Name$/i), { target: { value: 'Jane Doe' } });
    fireEvent.change(screen.getByLabelText(/^Email$/i), { target: { value: 'jane@example.com' } });
    fireEvent.change(screen.getByLabelText(/^Password$/i), { target: { value: 'Secret123' } });
    fireEvent.change(screen.getByLabelText(/^Confirm Password$/i), {
      target: { value: 'Secret123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    const resendBtn = await screen.findByRole('button', { name: /resend verification email/i });
    fireEvent.click(resendBtn);

    expect(
      await screen.findByText(/please wait before requesting another verification email/i)
    ).toBeTruthy();
  });

  it('navigates back to sign in from the confirmation screen', async () => {
    mocks.signUp.mockResolvedValueOnce({ error: null });

    renderPage();

    fireEvent.change(screen.getByLabelText(/^Name$/i), { target: { value: 'Jane Doe' } });
    fireEvent.change(screen.getByLabelText(/^Email$/i), { target: { value: 'jane@example.com' } });
    fireEvent.change(screen.getByLabelText(/^Password$/i), { target: { value: 'Secret123' } });
    fireEvent.change(screen.getByLabelText(/^Confirm Password$/i), {
      target: { value: 'Secret123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    const backBtn = await screen.findByRole('button', { name: /back to sign in/i });
    fireEvent.click(backBtn);

    expect(mocks.navigate).toHaveBeenCalledWith('/login');
  });

  it('displays rate-limit error message on signup rate limit', async () => {
    mocks.signUp.mockResolvedValueOnce({
      error: new Error('Rate limit exceeded: too many requests'),
    });

    renderPage();

    fireEvent.change(screen.getByLabelText(/^Name$/i), { target: { value: 'Jane Doe' } });
    fireEvent.change(screen.getByLabelText(/^Email$/i), { target: { value: 'jane@example.com' } });
    fireEvent.change(screen.getByLabelText(/^Password$/i), { target: { value: 'Secret123' } });
    fireEvent.change(screen.getByLabelText(/^Confirm Password$/i), {
      target: { value: 'Secret123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    expect(
      await screen.findByText(/too many registration attempts\. please wait a moment/i)
    ).toBeTruthy();
  });

  it('displays safe generic error message on generic signup failure', async () => {
    mocks.signUp.mockResolvedValueOnce({
      error: new Error('Internal Server Error'),
    });

    renderPage();

    fireEvent.change(screen.getByLabelText(/^Name$/i), { target: { value: 'Jane Doe' } });
    fireEvent.change(screen.getByLabelText(/^Email$/i), { target: { value: 'jane@example.com' } });
    fireEvent.change(screen.getByLabelText(/^Password$/i), { target: { value: 'Secret123' } });
    fireEvent.change(screen.getByLabelText(/^Confirm Password$/i), {
      target: { value: 'Secret123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    expect(
      await screen.findByText(/could not create account\. please check your details/i)
    ).toBeTruthy();
  });
});
