import { useState } from 'react';
import { View } from 'react-native';
import { FormScreen } from './FormScreen.js';
import { Body, Button, Chip, ChoiceRow, Display, ErrorText, Field } from '../ui.js';
import { ApiError } from '@photochase/client';
import type { DistanceUnits } from '@photochase/shared';
import { client } from '../api.js';
import { currentProfile, setCurrentProfile } from '../profile.js';
import { t } from '../i18n.js';

const UNIT_CHOICES: readonly DistanceUnits[] = ['metric', 'imperial'];

/**
 * Global settings: the display name other players see, and the units distances
 * are read in. The save is a full-profile PUT — the server takes a whole
 * profile, and one shape is simpler than a patch.
 *
 * First and last belong to the account and are shown for context, not editing.
 * Not reachable during game entry on purpose: these are chosen once and adjusted
 * here, never renegotiated at the moment of joining.
 */
export function ProfileScreen({ onBack }: { onBack: () => void }) {
  const profile = currentProfile();
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [units, setUnits] = useState<DistanceUnits>(profile?.units ?? 'metric');
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
        units,
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
        <Display>{t('settings.title')}</Display>
        <Body muted>{t('settings.prompt')}</Body>
      </View>

      {profile ? <Body muted>{`${profile.firstName} ${profile.lastName}`}</Body> : null}
      <Field
        label={t('profile.displayName')}
        value={displayName}
        onChangeText={setDisplayName}
        error={display === '' ? t('profile.required') : undefined}
        maxLength={40}
      />

      <ChoiceRow label={t('settings.units')}>
        {UNIT_CHOICES.map((u) => (
          <Chip key={u} selected={units === u} onPress={() => setUnits(u)}>
            {t(u === 'metric' ? 'units.metric' : 'units.imperial')}
          </Chip>
        ))}
      </ChoiceRow>

      {error ? <ErrorText>{error}</ErrorText> : null}
    </FormScreen>
  );
}
