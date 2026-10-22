import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfilePage } from './ProfilePage';

const mocks = vi.hoisted(() => ({
  profile: null as {
    id: string;
    username: string;
    display_name: string;
    avatar_url: string | null;
    bio: string | null;
    upi_id: string | null;
  } | null,
  refreshProfile: vi.fn(),
  signOut: vi.fn(),
  deleteAccount: vi.fn(),
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'current-user', email: 'current@example.com' },
    profile: mocks.profile,
    refreshProfile: mocks.refreshProfile,
    signOut: mocks.signOut,
    deleteAccount: mocks.deleteAccount,
  }),
}));

vi.mock('../../lib/supabase', () => ({ db: { from: vi.fn() } }));

describe('ProfilePage unavailable profile', () => {
  beforeEach(() => {
    mocks.profile = null;
    mocks.refreshProfile.mockReset();
  });

  it('offers a single-flight retry and hides profile editing until data loads', async () => {
    let resolveRefresh: () => void = () => {};
    mocks.refreshProfile.mockImplementation(
      () => new Promise<void>((resolve) => (resolveRefresh = resolve))
    );

    const view = render(
      <MemoryRouter>
        <ProfilePage />
      </MemoryRouter>
    );

    expect(screen.getByRole('alert').textContent).toContain('Your profile could not be loaded.');
    expect(screen.getByText('Profile unavailable')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit profile' })).toBeNull();
    expect(screen.queryByLabelText('Display name')).toBeNull();

    const retryButton = screen.getByRole('button', { name: 'Try again' });
    await userEvent.setup().click(retryButton);
    expect(retryButton.hasAttribute('disabled')).toBe(true);
    expect(mocks.refreshProfile).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRefresh();
    });
    expect(retryButton.hasAttribute('disabled')).toBe(false);

    mocks.profile = {
      id: 'current-user',
      username: 'current_user',
      display_name: 'Loaded profile',
      avatar_url: null,
      bio: null,
      upi_id: null,
    };
    view.rerender(
      <MemoryRouter>
        <ProfilePage />
      </MemoryRouter>
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Edit profile' }));
    expect(screen.getByDisplayValue('Loaded profile')).toBeTruthy();
  });
});
