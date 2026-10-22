import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AuthProvider } from '../../context/AuthContext';
import App from '../../App';

describe('legal and support routes', () => {
  it.each([
    ['/privacy', 'Privacy Policy'],
    ['/terms', 'Terms & Conditions'],
    ['/support', 'Contact & Support'],
  ])('renders %s with an explicit pre-release notice', async (path, title) => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: title })).toBeTruthy();
    expect(screen.getByText(/replace every bracketed placeholder/i)).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Legal and support' })).toBeTruthy();
  });
});
