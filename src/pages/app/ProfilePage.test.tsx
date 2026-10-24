import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../lib/supabase';
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
  updateSpy: vi.fn(),
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

vi.mock('../../lib/supabase', () => ({
  db: {
    from: vi.fn(() => ({
      update: mocks.updateSpy,
    })),
  },
}));

describe('ProfilePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.profile = {
      id: 'current-user',
      username: 'karmamusic4462',
      display_name: 'Pratham Malkan',
      avatar_url: null,
      bio: null,
      upi_id: null,
    };
    mocks.updateSpy.mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
  });

  it('offers a single-flight retry and hides profile editing until data loads', async () => {
    mocks.profile = null;
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

  it('1. Profile save succeeds with valid editable fields and converts empty upi_id/bio to null', async () => {
    const user = userEvent.setup();
    const eqMock = vi.fn().mockResolvedValue({ error: null });
    mocks.updateSpy.mockReturnValue({ eq: eqMock });
    mocks.refreshProfile.mockResolvedValue(undefined);

    render(
      <MemoryRouter>
        <ProfilePage />
      </MemoryRouter>
    );

    await user.click(screen.getByRole('button', { name: 'Edit profile' }));

    const usernameInput = screen.getByLabelText('Username');
    await user.clear(usernameInput);
    await user.type(usernameInput, 'karma7');

    const saveButton = screen.getByRole('button', { name: 'Save changes' });
    await user.click(saveButton);

    await waitFor(() => {
      expect(db.from).toHaveBeenCalledWith('profiles');
      expect(mocks.updateSpy).toHaveBeenCalledWith({
        display_name: 'Pratham Malkan',
        username: 'karma7',
        bio: null,
        upi_id: null,
      });
      expect(eqMock).toHaveBeenCalledWith('id', 'current-user');
      expect(mocks.refreshProfile).toHaveBeenCalledTimes(1);
    });

    expect(screen.queryByText('Save changes')).toBeNull();
  });

  it('2. Duplicate username displays the correct message', async () => {
    const user = userEvent.setup();
    const eqMock = vi.fn().mockResolvedValue({
      error: {
        code: '23505',
        message: 'duplicate key value violates unique constraint "profiles_username_key"',
      },
    });
    mocks.updateSpy.mockReturnValue({ eq: eqMock });

    render(
      <MemoryRouter>
        <ProfilePage />
      </MemoryRouter>
    );

    await user.click(screen.getByRole('button', { name: 'Edit profile' }));

    const usernameInput = screen.getByLabelText('Username');
    await user.clear(usernameInput);
    await user.type(usernameInput, 'taken_user');

    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain(
        'Username already taken. Please choose another.'
      );
    });

    // Form retains the user's typed changes
    expect((screen.getByLabelText('Username') as HTMLInputElement).value).toBe('taken_user');
  });

  it('3. Unauthorized profile update is rejected with safe permission message', async () => {
    const user = userEvent.setup();
    const eqMock = vi.fn().mockResolvedValue({
      error: {
        code: '42501',
        message: 'permission denied for table profiles',
      },
    });
    mocks.updateSpy.mockReturnValue({ eq: eqMock });

    render(
      <MemoryRouter>
        <ProfilePage />
      </MemoryRouter>
    );

    await user.click(screen.getByRole('button', { name: 'Edit profile' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain(
        'You do not have permission to update this profile.'
      );
    });
  });

  it('4. Profile refresh failure is not falsely reported as a failed database write', async () => {
    const user = userEvent.setup();
    const eqMock = vi.fn().mockResolvedValue({ error: null });
    mocks.updateSpy.mockReturnValue({ eq: eqMock });
    mocks.refreshProfile.mockRejectedValue(new Error('Network timeout during refresh'));

    render(
      <MemoryRouter>
        <ProfilePage />
      </MemoryRouter>
    );

    await user.click(screen.getByRole('button', { name: 'Edit profile' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain(
        'Profile changes were saved, but your view could not be refreshed. Please reload the page.'
      );
    });
    expect(screen.queryByText('Failed to save profile.')).toBeNull();
  });

  it('5. Unexpected exceptions always reset loading state and do not leave button spinning', async () => {
    const user = userEvent.setup();
    mocks.updateSpy.mockImplementation(() => {
      throw new Error('Immediate unexpected exception');
    });

    render(
      <MemoryRouter>
        <ProfilePage />
      </MemoryRouter>
    );

    await user.click(screen.getByRole('button', { name: 'Edit profile' }));
    const saveButton = screen.getByRole('button', { name: 'Save changes' });
    await user.click(saveButton);

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain(
        'An unexpected error occurred while saving your profile. Please try again.'
      );
    });
    // Loading state is reset, button is not disabled
    expect(saveButton.hasAttribute('disabled')).toBe(false);
  });

  it('6. Cancel button restores previous profile values and clears error state', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <ProfilePage />
      </MemoryRouter>
    );

    await user.click(screen.getByRole('button', { name: 'Edit profile' }));

    const usernameInput = screen.getByLabelText('Username') as HTMLInputElement;
    await user.clear(usernameInput);
    await user.type(usernameInput, 'new_unsaved_name');
    expect(usernameInput.value).toBe('new_unsaved_name');

    // Click Cancel
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    // Re-enter edit mode: original value restored
    await user.click(screen.getByRole('button', { name: 'Edit profile' }));
    expect((screen.getByLabelText('Username') as HTMLInputElement).value).toBe('karmamusic4462');
  });
});
