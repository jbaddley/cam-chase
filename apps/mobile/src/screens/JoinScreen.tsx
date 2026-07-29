import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { FormScreen } from './FormScreen.js';
import { color, radius, space, type as typeScale } from '../theme.js';
import { Body, Button, Card, Chip, ChoiceRow, Display, ErrorText, Field } from '../ui.js';
import { ApiError, type JoinAction, type TeamSummary } from '@photochase/client';
import { client } from '../api.js';
import { t } from '../i18n.js';

/** Handed back once the player is in the lobby, so the app can poll teams. */
export interface JoinedGame {
  gameId: string;
  code: string;
  teamId: string | null;
  role: string;
}

/** What resolving a code told us about the game behind it. */
interface Resolved {
  teams: TeamSummary[];
  isTag: boolean;
}

/**
 * Join a game in two steps: enter the code, then start a team or join one that
 * is already in.
 *
 * A team has many members now, any of whom can shoot for it, so joining an
 * existing team is a first-class path rather than everyone spawning their own
 * one-person team. The server has always supported it (`join_team`); this is the
 * UI that finally offers it.
 *
 * No "your name" field: identity comes from the signed-in profile
 * ({@link displayName}). The primary action names the first unmet requirement
 * rather than sitting inert (docs/10) — the silent-Join bug this replaced.
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
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [resolving, setResolving] = useState(false);
  const [teamName, setTeamName] = useState('');
  const [teamTouched, setTeamTouched] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Step one: look the game up by its code and learn its roster and mode. */
  async function find(): Promise<void> {
    if (code.length !== 6 || resolving) return;
    setResolving(true);
    setError(null);
    try {
      const view = await client.spectate(code);
      setResolved({ teams: view.game.teams, isTag: view.game.config.mode === 'photo_tag' });
    } catch {
      setError(t('join.notFound'));
    } finally {
      setResolving(false);
    }
  }

  /** Step two: join, either starting a team or joining one on the roster. */
  async function join(action: JoinAction): Promise<void> {
    if (busy || !resolved) return;
    // A tag game needs the photography acknowledgement before any playing join
    // (docs/07); the roster chips and the start action are both disabled without
    // it, so this is a guard, not the only defence.
    if (resolved.isTag && !agreed) return;
    setBusy(true);
    setError(null);
    try {
      const result = await client.joinGame({
        code,
        displayName,
        action,
        ...(resolved.isTag ? { acceptsBeingPhotographed: agreed } : {}),
      });
      onJoined({ gameId: result.gameId, code, teamId: result.teamId, role: result.role });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('join.failed'));
    } finally {
      setBusy(false);
    }
  }

  if (!resolved) {
    const label = resolving ? t('join.finding') : code.length === 6 ? t('join.findGame') : t('join.needCode');
    return (
      <FormScreen action={<Button onPress={find} disabled={code.length !== 6 || resolving}>{label}</Button>}>
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

  const team = teamName.trim();
  const consentOk = !resolved.isTag || agreed;
  const startReady = team !== '' && consentOk && !busy;
  const startLabel = busy
    ? t('join.joining')
    : team === ''
      ? t('join.needTeamName')
      : resolved.isTag && !agreed
        ? t('join.needConsent')
        : t('join.startTeam');

  return (
    <FormScreen
      action={
        <Button onPress={() => join({ type: 'create_team', name: team })} disabled={!startReady}>
          {startLabel}
        </Button>
      }
    >
      <View style={styles.hero}>
        <Display>{t('join.title')}</Display>
        <Body muted>{t('join.chooseTeam')}</Body>
      </View>

      {resolved.isTag ? (
        <Card tone="highlight">
          <Body>{t('join.tagConsent')}</Body>
          <Button onPress={() => setAgreed((yes) => !yes)} tone={agreed ? 'primary' : 'secondary'}>
            {t('join.tagAgree')}
          </Button>
        </Card>
      ) : null}

      {/* Existing teams to join, if any. Disabled until consent, same as the
          start action — joining a team is playing too. */}
      {resolved.teams.length > 0 ? (
        <ChoiceRow label={t('join.joinTeamLabel')}>
          {resolved.teams.map((team) => (
            <Chip
              key={team.teamId}
              onPress={() => join({ type: 'join_team', teamId: team.teamId })}
              disabled={!consentOk || busy}
            >
              {`${team.name} · ${t('join.members', { count: team.memberCount })}`}
            </Chip>
          ))}
        </ChoiceRow>
      ) : null}

      <Field
        label={t('join.startTeam')}
        value={teamName}
        onChangeText={setTeamName}
        onBlur={() => setTeamTouched(true)}
        placeholder={t('join.teamName')}
        error={teamTouched && team === '' ? t('profile.required') : undefined}
        maxLength={40}
      />

      {error ? <ErrorText>{error}</ErrorText> : null}

      <View style={styles.elsewhere}>
        <Button
          onPress={() => {
            setResolved(null);
            setError(null);
            setTeamName('');
            setTeamTouched(false);
            setAgreed(false);
          }}
          tone="secondary"
        >
          {t('common.back')}
        </Button>
      </View>
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
