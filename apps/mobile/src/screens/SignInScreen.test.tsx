import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const signIn = vi.fn();

vi.mock('../auth.js', async () => {
  class SignInCancelled extends Error {
    constructor() {
      super('cancelled');
      this.name = 'SignInCancelled';
    }
  }
  return { signIn: (a: unknown, p: unknown) => signIn(a, p), SignInCancelled };
});

const { SignInScreen } = await import('./SignInScreen.js');
const { SignInCancelled } = await import('../auth.js');

afterEach(() => {
  cleanup();
  signIn.mockReset();
});

describe('SignInScreen', () => {
  it('offers all four providers, with Apple first', () => {
    render(<SignInScreen authorize={vi.fn()} onSignedIn={vi.fn()} />);

    const buttons = screen.getAllByRole('button').map((b) => b.textContent);
    // Apple must lead: the App Store requires it alongside social login.
    expect(buttons[0]).toContain('Apple');
    expect(buttons).toEqual([
      'Continue with Apple',
      'Continue with Google',
      'Continue with Facebook',
      'Continue with X',
    ]);
  });

  it('signs in with the chosen provider and reports success', async () => {
    signIn.mockResolvedValue(undefined);
    const onSignedIn = vi.fn();
    const authorize = vi.fn();
    render(<SignInScreen authorize={authorize} onSignedIn={onSignedIn} />);

    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));

    await waitFor(() => expect(onSignedIn).toHaveBeenCalled());
    expect(signIn).toHaveBeenCalledWith(authorize, 'Google');
  });

  it('stays silent when the user dismisses the sheet', async () => {
    signIn.mockRejectedValue(new SignInCancelled());
    const onSignedIn = vi.fn();
    render(<SignInScreen authorize={vi.fn()} onSignedIn={onSignedIn} />);

    fireEvent.click(screen.getByRole('button', { name: 'Continue with Apple' }));

    await waitFor(() => expect(signIn).toHaveBeenCalled());
    // Cancelling is a normal action, not an error worth showing.
    expect(screen.queryByText('Sign-in failed. Please try again.')).toBeNull();
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  it('reports a genuine sign-in failure', async () => {
    signIn.mockRejectedValue(new Error('network down'));
    render(<SignInScreen authorize={vi.fn()} onSignedIn={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Continue with Facebook' }));

    expect(await screen.findByText('Sign-in failed. Please try again.')).toBeTruthy();
  });

  it('ignores a second tap while a sign-in is already running', async () => {
    signIn.mockImplementation(() => new Promise(() => {})); // never settles
    render(<SignInScreen authorize={vi.fn()} onSignedIn={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
    await screen.findByText('Opening…');
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Apple' }));

    expect(signIn).toHaveBeenCalledTimes(1);
  });
});
