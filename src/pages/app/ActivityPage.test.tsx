import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ActivityPage } from './ActivityPage';

const mocks = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'current-user' } }),
}));

vi.mock('../../lib/supabase', () => ({ supabase: { from: mocks.from } }));

describe('ActivityPage', () => {
  it('shows a recoverable error rather than an empty activity state when reads fail', async () => {
    mocks.from.mockImplementation(() => {
      const builder: Record<string, unknown> = {};
      builder.select = vi.fn(() => builder);
      builder.eq = vi.fn(() => builder);
      builder.order = vi.fn(() => ({
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: null, error: new Error('network unavailable') }).then(resolve),
      }));
      return builder;
    });

    render(
      <MemoryRouter>
        <ActivityPage />
      </MemoryRouter>
    );

    expect(await screen.findByText(/Activity could not be loaded/)).toBeTruthy();
    expect(screen.queryByText('No activity yet')).toBeNull();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
