import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LoadingScreen } from './LoadingScreen';

describe('LoadingScreen / IntroScreen', () => {
  it('renders Fall Split branding and developer credit', () => {
    render(<LoadingScreen />);

    expect(
      screen.getByRole('status', { name: /Fall Split - Developed by Pratham Malkan/i })
    ).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Fall\s*Split/i })).toBeTruthy();
    expect(screen.getByText('Developed by Pratham Malkan')).toBeTruthy();
  });
});
