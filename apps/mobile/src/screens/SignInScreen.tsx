import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { IdentityProvider } from '@photochase/client';
import { signIn, SignInCancelled, type Authorizer } from '../auth.js';
import { t } from '../i18n.js';

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
 * Provider picker. Each option opens that provider's page directly in a native
 * browser sheet rather than Cognito's chooser, so it reads as one tap.
 */
export function SignInScreen({ authorize, onSignedIn }: { authorize: Authorizer; onSignedIn: () => void }) {
  const [busy, setBusy] = useState<IdentityProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function start(provider: IdentityProvider): Promise<void> {
    if (busy) return;
    setBusy(provider);
    setError(null);
    try {
      await signIn(authorize, provider);
      onSignedIn();
    } catch (e) {
      // Dismissing the sheet is a normal action, not an error worth shouting.
      setError(e instanceof SignInCancelled ? null : t('auth.failed'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('app.title')}</Text>
      <Text style={styles.subtitle}>{t('auth.prompt')}</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {PROVIDERS.map((provider) => (
        <Pressable key={provider.id} onPress={() => start(provider.id)} style={styles.button}>
          <Text>
            {busy === provider.id ? t('auth.opening') : t('auth.continueWith', { provider: provider.name })}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 12, justifyContent: 'center' },
  title: { fontSize: 32, fontWeight: '700' },
  subtitle: { fontSize: 16, color: '#666', marginBottom: 12 },
  error: { color: '#c92a2a' },
  button: { backgroundColor: '#ffd43b', padding: 16, borderRadius: 12, alignItems: 'center' },
});
