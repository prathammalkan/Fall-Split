import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateGroupPage } from './CreateGroupPage';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  user: { id: 'current-user' },
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: mocks.user }),
}));

vi.mock('../../lib/supabase', () => ({ db: { rpc: mocks.rpc } }));

function GroupRoute() {
  const { groupId } = useParams();
  return <p>Created group: {groupId}</p>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/groups/new']}>
      <Routes>
        <Route path="/groups/new" element={<CreateGroupPage />} />
        <Route path="/groups/:groupId" element={<GroupRoute />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('CreateGroupPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates the group and owner membership through one RPC before navigating', async () => {
    mocks.rpc.mockResolvedValue({ data: 'group-123', error: null });
    renderPage();

    fireEvent.change(screen.getByPlaceholderText('e.g. Goa Trip 2025'), {
      target: { value: '  Goa trip  ' },
    });
    fireEvent.change(screen.getByPlaceholderText('What is this group for?'), {
      target: { value: '  Annual holiday  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create group' }));

    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith('create_group_with_owner', {
        p_name: 'Goa trip',
        p_description: 'Annual holiday',
        p_type: 'custom',
      })
    );
    expect(await screen.findByText('Created group: group-123')).toBeTruthy();
  });

  it('does not navigate or report success when the atomic creation RPC fails', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: new Error('database unavailable') });
    renderPage();
    fireEvent.change(screen.getByPlaceholderText('e.g. Goa Trip 2025'), {
      target: { value: 'Goa trip' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create group' }));

    expect(
      await screen.findByText(/Failed to create the group and add you as its admin/)
    ).toBeTruthy();
    expect(screen.queryByText(/Created group:/)).toBeNull();
  });
});
