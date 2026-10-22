import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchPage } from './SearchPage';

const mocks = vi.hoisted(() => ({ from: vi.fn(), dbFrom: vi.fn(), user: { id: 'current-user' } }));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: mocks.user }),
}));

vi.mock('../../lib/supabase', () => ({
  supabase: { from: mocks.from },
  db: { from: mocks.dbFrom },
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <SearchPage />
    </MemoryRouter>
  );
}

function searchBuilder(result: unknown) {
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'ilike', 'neq', 'limit']) {
    builder[method] = vi.fn(() => builder);
  }
  builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return builder;
}

describe('SearchPage error and stale-result handling', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows a retryable error instead of presenting a failed search as no matches', async () => {
    mocks.from
      .mockImplementationOnce(() => searchBuilder({ data: null, error: new Error('network') }))
      .mockImplementationOnce(() =>
        searchBuilder({
          data: [{ id: 'friend-1', username: 'alice', display_name: 'Alice', avatar_url: null }],
          error: null,
        })
      );
    renderPage();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'ali' } });

    expect(await screen.findByText('User search failed. Please try again.')).toBeTruthy();
    expect(screen.queryByText(/No users found/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Alice')).toBeTruthy();
  });

  it('ignores a late response from an older query', async () => {
    const pending: Array<(value: unknown) => void> = [];
    mocks.from.mockImplementation(() => {
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'ilike', 'neq', 'limit']) {
        builder[method] = vi.fn(() => builder);
      }
      builder.then = (resolve: (value: unknown) => unknown) =>
        new Promise((done) => pending.push(done)).then(resolve);
      return builder;
    });
    renderPage();
    const input = screen.getByRole('searchbox');
    fireEvent.change(input, { target: { value: 'al' } });
    await waitFor(() => expect(pending).toHaveLength(1));
    fireEvent.change(input, { target: { value: 'ali' } });
    await waitFor(() => expect(pending).toHaveLength(2));

    pending[0]!({
      data: [{ id: 'old', username: 'alex', display_name: 'Old response', avatar_url: null }],
      error: null,
    });
    await waitFor(() => expect(screen.queryByText('Old response')).toBeNull());

    pending[1]!({
      data: [{ id: 'new', username: 'alice', display_name: 'Current response', avatar_url: null }],
      error: null,
    });
    expect(await screen.findByText('Current response')).toBeTruthy();
    expect(screen.queryByText('Old response')).toBeNull();
  });
});
