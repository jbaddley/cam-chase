import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { FormScreen } from './FormScreen.js';
import { color, radius, space, type as typeScale } from '../theme.js';
import { Body, Button, Card, Chip, ChoiceRow, Display, ErrorText, Field } from '../ui.js';
import { ApiError, type JoinAction, type TeamSummary } from '@photochase/client';
import { parseJoinCode } from '@photochase/shared';
import { client } from '../api.js';
import { useBarcodeScan } from '../viewfinder.js';
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
  initialCode,
  onJoined,
  onBack,
}: {
  /** The signed-in player's display name, sent to the server as the joiner. */
  displayName: string;
  /** A code from a deep link, resolved automatically as if it had been typed. */
  initialCode?: string;
  onJoined: (game: JoinedGame) => void;
  onBack?: () => void;
}) {
  const [code, setCode] = useState(initialCode ?? '');
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [resolving, setResolving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [teamName, setTeamName] = useState('');
  const [teamTouched, setTeamTouched] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Step one: look the game up by its code and learn its roster and mode. Stable
   * so it can be a scan handler's target without re-subscribing; it reads only
   * its argument and setters, never render-scoped state.
   */
  const resolve = useCallback(async (value: string): Promise<void> => {
    if (value.length !== 6) return;
    setResolving(true);
    setError(null);
    try {
      const view = await client.spectate(value);
      setResolved({ teams: view.game.teams, isTag: view.game.config.mode === 'photo_tag' });
    } catch {
      setError(t('join.notFound'));
    } finally {
      setResolving(false);
    }
  }, []);

  /** A scanned QR resolves the game the same way typing the code does. */
  const onScanned = useCallback(
    (scanned: string) => {
      setScanning(false);
      setCode(scanned);
      void resolve(scanned);
    },
    [resolve],
  );

  // A code delivered from outside — a deep link the app was opened with —
  // resolves on its own, exactly as a typed or scanned one does.
  useEffect(() => {
    if (initialCode && initialCode.length === 6) {
      setCode(initialCode);
      void resolve(initialCode);
    }
  }, [initialCode, resolve]);

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

  if (scanning) {
    return <JoinScanner onScan={onScanned} onCancel={() => setScanning(false)} />;
  }

  if (!resolved) {
    const label = resolving ? t('join.finding') : code.length === 6 ? t('join.findGame') : t('join.needCode');
    return (
      <FormScreen action={<Button onPress={() => void resolve(code)} disabled={code.length !== 6 || resolving}>{label}</Button>}>
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

        {/* Scanning is the shortcut past typing six characters read across a
            room; typing stays as the fallback when a camera is refused. */}
        <Button onPress={() => setScanning(true)} tone="secondary">
          {t('join.scan')}
        </Button>
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

/**
 * The scan sub-screen: the camera preview runs behind (owned by CameraStage),
 * and this is the transparent overlay on top of it — a hint and a way out.
 *
 * The handler is idempotent: `onBarcodeScanned` fires repeatedly on the same
 * code, so a `done` ref disarms after the first *valid* one. A scan that is not
 * a join code is ignored, leaving the camera reading, rather than consumed.
 */
function JoinScanner({ onScan, onCancel }: { onScan: (code: string) => void; onCancel: () => void }) {
  const done = useRef(false);
  const handle = useCallback(
    (data: string) => {
      if (done.current) return;
      const code = parseJoinCode(data);
      if (!code) return;
      done.current = true;
      onScan(code);
    },
    [onScan],
  );
  useBarcodeScan(handle);

  return (
    <View style={styles.scan} testID="join-scanner">
      <View style={styles.scanHint}>
        <Card>
          <Body>{t('join.scanHint')}</Body>
        </Card>
        <Button onPress={onCancel} tone="secondary">
          {t('common.back')}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { paddingBottom: space.md, gap: space.xs },
  // Transparent so the camera preview behind it shows through; the hint and the
  // way out sit at the bottom third, in a thumb's reach (docs/10).
  scan: { flex: 1, justifyContent: 'flex-end' },
  scanHint: { padding: space.xl, gap: space.md },
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
