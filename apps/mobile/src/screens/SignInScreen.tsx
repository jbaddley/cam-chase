import { useState } from 'react';
import type { IdentityProvider } from '@photochase/client';
import { signIn, SignInCancelled, type Authorizer } from '../auth.js';
import { t } from '../i18n.js';
import { Body, Button, Display, ErrorText, Screen } from '../ui.js';

/**
 * Sign in with Apple is listed first and is not optional: the App Store
 * requires it whenever an app offers third-party social login.
 */
const PROVIDERS: Array<{ id: IdentityProvider; name: string }> = [
  { id: 'SignInWithApple', name: 'Apple' },
  { id: 'Google', name: 'Google' },
  { id: 'Facebook', name: 'Facebook' },
  { id: 'TwitterX', name: 'X' },
];

/**
 * What the user picked. `email` is not an identity provider — it means *no*
 * provider, which is what makes Cognito show its own page.
 */
type Choice = IdentityProvider | 'email';

/**
 * Provider picker. Each social option opens that provider's page directly in a
 * native browser sheet rather than Cognito's chooser, so it reads as one tap.
 *
 * Email is last, and it is the only option that works against a user pool
 * deployed without social IdP credentials — a bare stack supports `COGNITO`
 * alone, so without this the app could not be signed into at all until someone
 * had registered an app with Google or Apple. It is a real sign-in method
 * rather than a debug affordance: not everyone wants to hand a party game
 * their social account.
 */
export function SignInScreen({ authorize, onSignedIn }: { authorize: Authorizer; onSignedIn: () => void }) {
  const [busy, setBusy] = useState<Choice | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function start(choice: Choice): Promise<void> {
    if (busy) return;
    setBusy(choice);
    setError(null);
    try {
      // Naming no provider is what keeps Cognito on its own sign-up/sign-in
      // page instead of redirecting straight out to somebody else's.
      await signIn(authorize, choice === 'email' ? undefined : choice);
      onSignedIn();
    } catch (e) {
      // Dismissing the sheet is a normal action, not an error worth shouting.
      setError(e instanceof SignInCancelled ? null : t('auth.failed'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen scroll>
      <Display>{t('app.title')}</Display>
      <Body muted>{t('auth.prompt')}</Body>
      {error ? <ErrorText>{error}</ErrorText> : null}
      {PROVIDERS.map((provider) => (
        <Button key={provider.id} onPress={() => start(provider.id)}>
          {busy === provider.id ? t('auth.opening') : t('auth.continueWith', { provider: provider.name })}
        </Button>
      ))}
      <Button onPress={() => start('email')} tone="secondary">
        {busy === 'email' ? t('auth.opening') : t('auth.continueWithEmail')}
      </Button>
    </Screen>
  );
}

