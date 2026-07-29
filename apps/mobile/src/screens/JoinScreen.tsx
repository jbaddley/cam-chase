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
 * Enter a 6-character game code and name a team.
 *
 * No "your name" field any more: identity comes from the signed-in profile
 * ({@link displayName}), captured once at sign-in rather than re-entered every
 * game. That field was also below the fold, and pressing Join with it blank did
 * nothing at all — so the primary action now names what is missing (docs/10)
 * instead of sitting inert, and each field flags itself once left empty.
 */
export function JoinScreen({
  displayName,
  onJoined,
  onBack,
}: {
  /** The signed-in player's display name, sent to the server as the joiner. */
  displayName: string;
  onJoined: (game: JoinedGame) => void;
  onBack?: () => void;
}) {
  const [code, setCode] = useState('');
  const [teamName, setTeamName] = useState('');
  const [teamTouched, setTeamTouched] = useState(false);
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

  const team = teamName.trim();
  const ready = code.length === 6 && team !== '' && (!isTag || agreed) && !busy;

  // The primary action says why it is blocked rather than sitting greyed with
  // the same label (docs/10): the first unmet requirement, top to bottom.
  const reason =
    code.length !== 6
      ? t('join.needCode')
      : team === ''
        ? t('join.needTeamName')
        : isTag && !agreed
          ? t('join.needConsent')
          : null;
  const label = busy ? t('join.joining') : reason ?? t('join.submit');

  async function submit(): Promise<void> {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const result = await client.joinGame({
        code,
        displayName,
        action: { type: 'create_team', name: team },
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
    // Join is a keyboard-heavy screen, and on a small phone the action below the
    // fields was entirely behind the keyboard until FormScreen pinned it.
    <FormScreen action={<Button onPress={submit} disabled={!ready}>{label}</Button>}>
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
      <Field
        value={teamName}
        onChangeText={setTeamName}
        onBlur={() => setTeamTouched(true)}
        placeholder={t('join.teamName')}
        error={teamTouched && team === '' ? t('profile.required') : undefined}
        maxLength={40}
      />

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
