import { useState } from 'react';
import { View } from 'react-native';
import { FormScreen } from './FormScreen.js';
import { Body, Button, Display, ErrorText, Field } from '../ui.js';
import { ApiError } from '@photochase/client';
import { client } from '../api.js';
import { currentProfile, setCurrentProfile } from '../profile.js';
import { t } from '../i18n.js';

/**
 * Edit the one piece of the profile that changes: the display name. First and
 * last belong to the account and are shown for context, not editing. The save is
 * a full-profile PUT that re-sends them unchanged — the server takes a whole
 * profile, and one shape is simpler than a patch.
 *
 * Not reachable during game entry on purpose (the plan): a display name is
 * chosen once and adjusted here, never renegotiated at the moment of joining.
 */
export function ProfileScreen({ onBack }: { onBack: () => void }) {
  const profile = currentProfile();
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const display = displayName.trim();
  const ready = profile !== null && display !== '' && !busy;
  const label = busy ? t('profile.saving') : ready ? t('profile.save') : t('profile.needFields');

  async function save(): Promise<void> {
    if (!profile || !ready) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await client.saveProfile({
        firstName: profile.firstName,
        lastName: profile.lastName,
        displayName: display,
      });
      setCurrentProfile(saved);
      onBack();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('profile.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormScreen
      action={
        <>
          <Button onPress={save} disabled={!ready}>
            {label}
          </Button>
          <Button onPress={onBack} tone="secondary">
            {t('common.back')}
          </Button>
        </>
      }
    >
      <View style={{ gap: 4, paddingBottom: 8 }}>
        <Display>{t('profile.title')}</Display>
        <Body muted>{t('profile.editPrompt')}</Body>
      </View>

      {profile ? <Body muted>{`${profile.firstName} ${profile.lastName}`}</Body> : null}
      <Field
        label={t('profile.displayName')}
        value={displayName}
        onChangeText={setDisplayName}
        error={display === '' ? t('profile.required') : undefined}
        maxLength={40}
      />

      {error ? <ErrorText>{error}</ErrorText> : null}
    </FormScreen>
  );
}
