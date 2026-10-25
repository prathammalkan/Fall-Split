import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AddExpensePage } from './AddExpensePage';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  user: { id: 'current-user' },
  profile: {
    id: 'current-user',
    username: 'current',
    display_name: 'Current User',
    avatar_url: null,
  } as {
    id: string;
    username: string;
    display_name: string;
    avatar_url: null;
  } | null,
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: mocks.user, profile: mocks.profile }),
}));

vi.mock('../../lib/supabase', () => ({
  supabase: { from: mocks.from },
  db: { rpc: mocks.rpc },
}));

function failingBuilder(singleResult = false) {
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'is']) {
    builder[method] = vi.fn(() => builder);
  }
  builder.single = vi.fn().mockResolvedValue({ data: null, error: new Error('group read failed') });
  builder.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve({ data: [], error: null }).then(resolve);
  if (singleResult) {
    builder.then = undefined;
  }
  return builder;
}

describe('AddExpensePage participant loading', () => {
  beforeEach(() => {
    mocks.profile = {
      id: 'current-user',
      username: 'current',
      display_name: 'Current User',
      avatar_url: null,
    };
  });

  it('shows a retryable read error and blocks continuing when group lookup fails', async () => {
    mocks.from.mockImplementation((table: string) =>
      table === 'groups' ? failingBuilder(true) : failingBuilder()
    );
    render(
      <MemoryRouter initialEntries={['/expenses/new?groupId=group-1']}>
        <Routes>
          <Route path="/expenses/new" element={<AddExpensePage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(
      await screen.findByText('Group members could not be loaded. Check access and try again.')
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next: Split' }).hasAttribute('disabled')).toBe(true);
  });

  it('shows a retryable profile error instead of leaving contacts loading forever', async () => {
    mocks.profile = null;
    render(
      <MemoryRouter initialEntries={['/expenses/new']}>
        <Routes>
          <Route path="/expenses/new" element={<AddExpensePage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(
      await screen.findByText('Your profile could not be loaded. Refresh the page or try again.')
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next: Split' }).hasAttribute('disabled')).toBe(true);
  });

  it('renders pre-submission confirmation dialog before executing expense save', async () => {
    mocks.from.mockImplementation(() => {
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'or', 'eq', 'in', 'is']) {
        builder[method] = vi.fn(() => builder);
      }
      builder.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve);
      return builder;
    });

    const userEvent = (await import('@testing-library/user-event')).default.setup();

    render(
      <MemoryRouter initialEntries={['/expenses/new']}>
        <Routes>
          <Route path="/expenses/new" element={<AddExpensePage />} />
        </Routes>
      </MemoryRouter>
    );

    // Wait for contacts to load
    const amountInput = await screen.findByPlaceholderText('0.00');
    await userEvent.type(amountInput, '100');
    await userEvent.type(screen.getByPlaceholderText(/Dinner, taxi/i), 'Team Pizza');

    // Click Next: Split
    await userEvent.click(screen.getByRole('button', { name: 'Next: Split' }));

    // On split screen, click Save expense
    const saveBtn = await screen.findByRole('button', { name: 'Save expense' });
    await userEvent.click(saveBtn);

    // Confirm dialog is rendered
    const confirmDialog = await screen.findByRole('dialog', { name: 'Confirm expense submission' });
    expect(confirmDialog).toBeTruthy();
    expect(screen.getAllByText('Team Pizza').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: 'Confirm & Submit' })).toBeTruthy();
  });
});
