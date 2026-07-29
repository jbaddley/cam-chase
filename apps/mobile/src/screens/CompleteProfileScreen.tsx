import { useState } from 'react';
import { View } from 'react-native';
import { FormScreen } from './FormScreen.js';
import { Body, Button, Display, ErrorText, Field } from '../ui.js';
import { ApiError, type ProfileView } from '@photochase/client';
import { client } from '../api.js';
import { setCurrentProfile } from '../profile.js';
import { t } from '../i18n.js';

/**
 * Shown once, after first sign-in, before the app proper: capture the identity
 * that used to be a per-game "your name" field. All three are required — a
 * display name is what other players see, and first/last belong to the account.
 *
 * The primary action names what is missing rather than sitting greyed with the
 * same label (docs/10), and each field flags itself once left empty, so a blank
 * form never fails silently the way the old Join did.
 */
export function CompleteProfileScreen({ onDone }: { onDone: (profile: ProfileView) => void }) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [touched, setTouched] = useState<{ first?: boolean; last?: boolean; display?: boolean }>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const first = firstName.trim();
  const last = lastName.trim();
  const display = displayName.trim();
  const ready = first !== '' && last !== '' && display !== '' && !busy;

  const required = t('profile.required');
  const label = busy ? t('profile.saving') : ready ? t('profile.save') : t('profile.needFields');

  async function save(): Promise<void> {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await client.saveProfile({ firstName: first, lastName: last, displayName: display });
      setCurrentProfile(saved);
      onDone(saved);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('profile.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormScreen action={<Button onPress={save} disabled={!ready}>{label}</Button>}>
      <View style={{ gap: 4, paddingBottom: 8 }}>
        <Display>{t('profile.completeTitle')}</Display>
        <Body muted>{t('profile.completePrompt')}</Body>
      </View>

      <Field
        label={t('profile.firstName')}
        value={firstName}
        onChangeText={setFirstName}
        onBlur={() => setTouched((was) => ({ ...was, first: true }))}
        error={touched.first && first === '' ? required : undefined}
        maxLength={40}
      />
      <Field
        label={t('profile.lastName')}
        value={lastName}
        onChangeText={setLastName}
        onBlur={() => setTouched((was) => ({ ...was, last: true }))}
        error={touched.last && last === '' ? required : undefined}
        maxLength={40}
      />
      <Field
        label={t('profile.displayName')}
        value={displayName}
        onChangeText={setDisplayName}
        onBlur={() => setTouched((was) => ({ ...was, display: true }))}
        error={touched.display && display === '' ? required : undefined}
        maxLength={40}
      />

      {error ? <ErrorText>{error}</ErrorText> : null}
    </FormScreen>
  );
}
