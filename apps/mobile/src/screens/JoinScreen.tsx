import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { FormScreen } from './FormScreen.js';
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

/** Enter a 6-character game code (or arrive here via a scanned QR deep link). */
export function JoinScreen({
  onJoined,
  onHost,
  onDailyHunt,
  onLeagues,
  onInvite,
}: {
  onJoined: (game: JoinedGame) => void;
  onHost?: () => void;
  onDailyHunt?: () => void;
  onLeagues?: () => void;
  onInvite?: () => void;
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
        <Pressable onPress={submit} style={styles.button}>
          <Text>{busy ? t('join.joining') : t('join.submit')}</Text>
        </Pressable>
      }
    >
      <Text style={styles.title}>{t('join.title')}</Text>
      <TextInput
        value={code}
        onChangeText={(text) => setCode(text.toUpperCase())}
        placeholder="ABC123"
        maxLength={6}
        autoCapitalize="characters"
        style={styles.input}
      />
      <TextInput value={name} onChangeText={setName} placeholder={t('join.yourName')} style={styles.textField} />
      <TextInput value={teamName} onChangeText={setTeamName} placeholder={t('join.teamName')} style={styles.textField} />
      {isTag ? (
        <View style={styles.consent}>
          <Text style={styles.consentText}>{t('join.tagConsent')}</Text>
          <Pressable onPress={() => setAgreed((yes) => !yes)} style={agreed ? styles.agreed : styles.agree}>
            <Text>{t('join.tagAgree')}</Text>
          </Pressable>
        </View>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {onHost ? (
        <Pressable onPress={onHost} style={styles.secondary}>
          <Text>{t('join.hostInstead')}</Text>
        </Pressable>
      ) : null}
      {onDailyHunt ? (
        <Pressable onPress={onDailyHunt} style={styles.secondary}>
          <Text>{t('daily.title')}</Text>
        </Pressable>
      ) : null}
      {onLeagues ? (
        <Pressable onPress={onLeagues} style={styles.secondary}>
          <Text>{t('league.title')}</Text>
        </Pressable>
      ) : null}
      {onInvite ? (
        <Pressable onPress={onInvite} style={styles.secondary}>
          <Text>{t('referral.title')}</Text>
        </Pressable>
      ) : null}
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '700' },
  input: { fontSize: 24, letterSpacing: 4, borderWidth: 1, padding: 12 },
  textField: { fontSize: 18, borderWidth: 1, padding: 12 },
  error: { color: '#c92a2a' },
  button: { backgroundColor: '#ffd43b', padding: 16, borderRadius: 12, alignItems: 'center' },
  secondary: { padding: 16, borderRadius: 12, alignItems: 'center' },
  consent: { gap: 8, paddingVertical: 8 },
  consentText: { color: '#495057' },
  agree: { backgroundColor: '#e9ecef', padding: 12, borderRadius: 8, alignItems: 'center' },
  agreed: { backgroundColor: '#ffd43b', padding: 12, borderRadius: 8, alignItems: 'center' },
});
