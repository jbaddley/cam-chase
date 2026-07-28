import { useEffect, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { FormScreen } from './FormScreen.js';
import { color, radius, space, type as typeScale } from '../theme.js';
import { Body, Button, Card, Display, ErrorText, Field } from '../ui.js';
import { ApiError } from '@photochase/client';
import { client } from '../api.js';
import { t } from '../i18n.js';

/** Handed back once the player is in the lobby, so the app can poll teams. */
export interface JoinedGame {
  gameId: string;
  code: string;
  teamId: string | null;
  role: string;
}

/**
 * Enter a 6-character game code (or arrive here via a scanned QR deep link).
 *
 * Only joining. The other routes into the app moved to the home screen, which
 * left this free to be one job: get the code right.
 */
export function JoinScreen({
  onJoined,
  onBack,
}: {
  onJoined: (game: JoinedGame) => void;
  onBack?: () => void;
}) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [teamName, setTeamName] = useState('');
  const [isTag, setIsTag] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * Peek at the game's mode before joining, using the same public endpoint the
   * big screen uses. A tag game requires an acknowledgement that other players
   * will photograph you (docs/07) — asking every joiner that would be noise, and
   * asking nobody would mean every tag join failed on the server's gate.
   */
  useEffect(() => {
    if (code.length !== 6) {
      setIsTag(false);
      return;
    }
    let active = true;
    client
      .spectate(code)
      .then((view) => {
        if (active) setIsTag(view.game.config.mode === 'photo_tag');
      })
      .catch(() => {
        // An unknown code is not an error here; the join itself will say so.
        if (active) setIsTag(false);
      });
    return () => {
      active = false;
    };
  }, [code]);

  const ready =
    code.length === 6 &&
    name.trim().length > 0 &&
    teamName.trim().length > 0 &&
    (!isTag || agreed) &&
    !busy;

  async function submit(): Promise<void> {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const result = await client.joinGame({
        code,
        displayName: name.trim(),
        action: { type: 'create_team', name: teamName.trim() },
        ...(isTag ? { acceptsBeingPhotographed: agreed } : {}),
      });
      onJoined({ gameId: result.gameId, code, teamId: result.teamId, role: result.role });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('join.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    // Join is the most keyboard-heavy screen in the app — three fields, and on
    // a small phone the buttons below them were entirely behind the keyboard.
    <FormScreen
      action={
        <Button onPress={submit}>{busy ? t('join.joining') : t('join.submit')}</Button>
      }
    >
      <View style={styles.hero}>
        <Display>{t('join.title')}</Display>
        <Body muted>{t('join.prompt')}</Body>
      </View>

      {/* The code gets its own oversized field: it is dictated across a room,
          six characters at a time, and typo-ing it is the commonest failure. */}
      <TextInput
        value={code}
        onChangeText={(text) => setCode(text.toUpperCase())}
        placeholder="ABC123"
        maxLength={6}
        autoCapitalize="characters"
        style={styles.codeInput}
      />
      <Field value={name} onChangeText={setName} placeholder={t('join.yourName')} />
      <Field value={teamName} onChangeText={setTeamName} placeholder={t('join.teamName')} />

      {isTag ? (
        <Card tone="highlight">
          <Body>{t('join.tagConsent')}</Body>
          <Button onPress={() => setAgreed((yes) => !yes)} tone={agreed ? 'primary' : 'secondary'}>
            {t('join.tagAgree')}
          </Button>
        </Card>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}

      {onBack ? (
        <View style={styles.elsewhere}>
          <Button onPress={onBack} tone="secondary">
            {t('common.back')}
          </Button>
        </View>
      ) : null}
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  hero: { paddingBottom: space.md, gap: space.xs },
  codeInput: {
    ...typeScale.title,
    letterSpacing: 6,
    textAlign: 'center',
    color: color.ink,
    backgroundColor: color.surfaceSunken,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: color.border,
    paddingVertical: space.lg,
  },
  elsewhere: { gap: space.sm, paddingTop: space.md },
});
