import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ShareInviteModal } from './ShareInviteModal';

const mocks = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'owner-1' }, emailVerified: true }),
}));

vi.mock('../../lib/supabase', () => ({ db: { from: mocks.from } }));

vi.mock('react-qr-code', () => ({
  default: ({ value }: { value: string }) => <div data-testid="qr-code" data-value={value} />,
}));

describe('ShareInviteModal invitation URL consistency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.from.mockReturnValue({
      insert: vi.fn(() => ({
        then: (resolve: (result: { error: null }) => unknown) =>
          Promise.resolve({ error: null }).then(resolve),
      })),
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    });
  });

  it('uses one identical URL for the QR payload, displayed link, clipboard, and share sheet', async () => {
    render(<ShareInviteModal onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate invite link' }));

    const input = await screen.findByRole('textbox', { name: 'Invite link' });
    const inviteUrl = (input as HTMLInputElement).value;
    expect(inviteUrl).toMatch(/^https?:\/\/[^/]+\/invite\/[a-f0-9]{64}$/);
    expect(screen.getByTestId('qr-code').getAttribute('data-value')).toBe(inviteUrl);

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(inviteUrl));

    fireEvent.click(screen.getByRole('button', { name: 'Share link' }));
    await waitFor(() =>
      expect(navigator.share).toHaveBeenCalledWith(expect.objectContaining({ url: inviteUrl }))
    );
  });
});
