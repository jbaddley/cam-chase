import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ApiError, type RegroupView } from '@photochase/client';
import type { GameMode, GameState, TeamReturnStatus } from '@photochase/shared';
import type { MessageKey } from '@photochase/i18n';
import { client } from '../api.js';
import { CaptureError } from '../capture.js';
import { t } from '../i18n.js';
import type { LocationSource } from '../location.js';
import { color, space, type as typeScale } from '../theme.js';
import { Body, Button, Card, ErrorText, Heading, Pill, Row, Title } from '../ui.js';
import { ViewfinderFrame } from './ViewfinderFrame.js';

/** Don't hammer the endpoint while a team walks; a fix every ten seconds is plenty. */
const AUTO_INTERVAL_MS = 10_000;

const STATUS_KEY: Record<TeamReturnStatus, MessageKey> = {
  shooting: 'regroup.status.shooting',
  heading_back: 'regroup.status.headingBack',
  ready: 'regroup.status.ready',
};

/**
 * The regroup screen: get back to where you started, and see who else has.
 *
 * This replaces a screen that was one button and a sentence, and it took its
 * location by *taking a photograph* — opening the camera, waiting for a shutter,
 * and throwing the image away — because a `CaptureSource` was the only source of
 * a fix a screen could reach. It takes a `LocationSource` now.
 *
 * Checking in happens two ways and the automatic one is the point: a team walking
 * back should not have to remember to tell the app they arrived. The manual
 * button stays because automatic failures are deliberately silent — see below —
 * and a player who thinks they are back deserves to be told why they are not.
 */
export function ReturnScreen({
  gameId,
  mode,
  isHost,
  regroup,
  error,
  location,
  refresh,
  onAdvanced,
  landscape,
}: {
  gameId: string;
  mode: GameMode;
  isHost: boolean;
  regroup: RegroupView | null;
  error?: string | null;
  location: LocationSource;
  refresh: () => void;
  onAdvanced?: (state: GameState) => void;
  landscape?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const me = regroup?.me ?? null;
  const headingBack = me?.status === 'heading_back';

  /**
   * Attempt a check-in and let the server decide.
   *
   * The client never learns where the start point is — that would put a live
   * game's location on the wire, and from there into the unauthenticated
   * spectator view. So there is no client-side geofence to duplicate: the fix
   * goes up, and the answer comes back.
   */
  async function attempt(auto: boolean): Promise<void> {
    if (busy) return;
    setBusy(true);
    if (!auto) setFailure(null);
    try {
      const fix = await location.current();
      await client.checkIn(gameId, { location: fix, ...(auto ? { auto: true } : {}) });
      refresh();
    } catch (e) {
      // Automatic failures stay silent. Surfacing them would flash "about 300 m
      // to go" every ten seconds for the whole walk back, which is noise dressed
      // up as feedback. Only a deliberate press earns an explanation.
      if (!auto) {
        setFailure(e instanceof ApiError || e instanceof CaptureError ? e.message : t('regroup.failed'));
      }
    } finally {
      setBusy(false);
    }
  }

  /**
   * Held in a ref so the subscription below depends only on *whether* to watch,
   * not on a function identity that changes every render — otherwise each render
   * tears down the location subscription and starts a new one, which on a device
   * means never actually settling into a watch.
   */
  const attemptRef = useRef(attempt);
  attemptRef.current = attempt;

  // Watch only while this team is actually walking back. Before the quota is met
  // the server would refuse anyway, and at kickoff every team is standing on the
  // start point — so an unconditional watch would check the whole field in
  // before the game began.
  const lastAttempt = useRef(0);
  useEffect(() => {
    if (!headingBack) return;
    return location.watch(() => {
      const now = Date.now();
      if (now - lastAttempt.current < AUTO_INTERVAL_MS) return;
      lastAttempt.current = now;
      void attemptRef.current(true);
    });
  }, [headingBack, location]);

  if (!regroup) {
    return (
      <ViewfinderFrame landscape={landscape}>
        <Title>{t('regroup.title')}</Title>
        <Body muted>{error ?? t('watch.connecting')}</Body>
      </ViewfinderFrame>
    );
  }

  return (
    <ViewfinderFrame
      landscape={landscape}
      action={
        <>
          {me ? <CheckInButton me={me} busy={busy} onPress={() => void attempt(false)} /> : null}
          {isHost ? (
            <HostControls
              gameId={gameId}
              mode={mode}
              regroup={regroup}
              location={location}
              refresh={refresh}
              onAdvanced={onAdvanced}
            />
          ) : null}
        </>
      }
    >
      <Title>{t('regroup.title')}</Title>
      <Body muted>{regroup.fenced ? t('regroup.instruction') : t('regroup.instructionUnfenced')}</Body>

      <Body muted>
        {regroup.allReady
          ? t('regroup.allBack')
          : t('regroup.waitingFor', { count: regroup.teamCount - regroup.readyCount })}
      </Body>

      {regroup.teams.map((team) => (
        <Card key={team.teamId} tone={team.status === 'ready' ? 'highlight' : 'plain'}>
          <Row>
            <Text style={styles.teamName}>{team.name}</Text>
            <Pill tone={team.status === 'ready' ? 'positive' : 'accent'}>{t(STATUS_KEY[team.status])}</Pill>
          </Row>
        </Card>
      ))}

      {headingBack ? <Body muted>{t('regroup.autoNotice')}</Body> : null}
      {failure ? <ErrorText>{failure}</ErrorText> : null}
    </ViewfinderFrame>
  );
}

/** The check-in button, whose label is the team's own status. */
function CheckInButton({
  me,
  busy,
  onPress,
}: {
  me: NonNullable<RegroupView['me']>;
  busy: boolean;
  onPress: () => void;
}) {
  if (me.status === 'ready') {
    return (
      <Button onPress={() => {}} disabled>
        {t('regroup.checkedIn')}
      </Button>
    );
  }
  if (me.status === 'shooting') {
    // Disabled with a different label rather than a greyed-out same one: the
    // reason you cannot press it is the useful part.
    return (
      <Button onPress={() => {}} disabled>
        {t('regroup.finishFirst', { done: me.done, goal: me.goal })}
      </Button>
    );
  }
  return <Button onPress={onPress}>{busy ? t('regroup.checkingIn') : t('regroup.checkIn')}</Button>;
}

/**
 * The host's controls — the first phase-advance UI in the product. Until now
 * Round 1 could not be ended from the app at all; phases only moved in tests.
 */
function HostControls({
  gameId,
  mode,
  regroup,
  location,
  refresh,
  onAdvanced,
}: {
  gameId: string;
  mode: GameMode;
  regroup: RegroupView;
  location: LocationSource;
  refresh: () => void;
  onAdvanced?: (state: GameState) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  /**
   * Correct the meeting spot mid-game.
   *
   * The spot is recorded when Start is pressed, which assumes the host was
   * standing at it. They will not always be — they press Start in the car, at
   * home, on the way over — and without this that mistake is unrecoverable:
   * the fence is measured from the wrong place, nobody can check in, and the only
   * escape is forcing past the gate and costing every team its return bonus.
   *
   * Clearing is not a weaker version of moving. When the host's *own* device is
   * what is in the wrong place, re-recording from it stores the same wrong point
   * again, so dropping the fence is the only way out.
   */
  async function setSpot(clear: boolean): Promise<void> {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    setNote(null);
    try {
      const fix = clear ? undefined : await location.current();
      await client.setStartSpot(gameId, clear ? { clear: true } : { location: fix });
      setNote(clear ? t('host.spotCleared') : t('host.spotSet'));
      refresh();
    } catch (e) {
      setFailure(e instanceof ApiError || e instanceof CaptureError ? e.message : t('host.spotFailed'));
    } finally {
      setBusy(false);
    }
  }

  const waiting = regroup.teamCount - regroup.readyCount;
  const completeEvent = regroup.round === 1 ? 'COMPLETE_RETURN1' : 'COMPLETE_RETURN2';
  const endEvent = regroup.round === 1 ? 'END_ROUND1' : 'END_ROUND2';
  // A scavenger hunt has one round, so completing its return goes to rating.
  const completeLabel =
    regroup.round === 1 && mode === 'scavenger_hunt' ? t('host.goToRating') : t('host.startRound2');

  async function advance(event: typeof completeEvent | typeof endEvent, force = false): Promise<void> {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const { state } = await client.advanceGame(gameId, event, force ? { force: true } : {});
      setAsking(false);
      onAdvanced?.(state);
    } catch (e) {
      setFailure(e instanceof ApiError ? e.message : t('host.advanceFailed'));
    } finally {
      setBusy(false);
    }
  }

  if (asking) {
    return (
      <View style={styles.confirm}>
        <Heading>{t('host.startAnywayConfirm')}</Heading>
        <Body muted>{t('host.startAnywayBody')}</Body>
        {failure ? <ErrorText>{failure}</ErrorText> : null}
        <Button onPress={() => void advance(completeEvent, true)} tone="danger">
          {t('host.startAnyway')}
        </Button>
        <Button onPress={() => setAsking(false)} tone="secondary">
          {t('common.back')}
        </Button>
      </View>
    );
  }

  return (
    <>
      {failure ? <ErrorText>{failure}</ErrorText> : null}
      {note ? <Body muted>{note}</Body> : null}
      {/* Still shooting: the host closes the round for everyone. */}
      {!regroup.calledBack ? (
        <Button onPress={() => void advance(endEvent)} tone="secondary">
          {t('host.callBack')}
        </Button>
      ) : null}

      {regroup.allReady ? (
        <Button onPress={() => void advance(completeEvent)}>{completeLabel}</Button>
      ) : (
        <>
          <Button onPress={() => {}} disabled>
            {t('host.startRound2Waiting', { count: waiting })}
          </Button>
          {/* Two taps, because forcing costs those teams their return bonus. */}
          <Button onPress={() => setAsking(true)} tone="secondary">
            {t('host.startAnyway')}
          </Button>
        </>
      )}

      {/* Correcting the spot beats forcing past it: a team that can check in
          keeps its return bonus, and a team that cannot loses it. */}
      <Button onPress={() => void setSpot(false)} tone="secondary">
        {t('host.spotHere')}
      </Button>
      {regroup.fenced ? (
        <Button onPress={() => void setSpot(true)} tone="secondary">
          {t('host.spotClear')}
        </Button>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  teamName: { ...typeScale.heading, color: color.ink, flexShrink: 1 },
  confirm: { gap: space.sm },
});
