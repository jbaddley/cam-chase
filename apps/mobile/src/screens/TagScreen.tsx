import { useCallback, useEffect, useState } from 'react';
import { ApiError, type CatchClaimView, type TagBriefView, type TeamSummary } from '@photochase/client';
import type { CatchStatus, TagRole, TagSubMode } from '@photochase/shared';
import type { MessageKey } from '@photochase/i18n';
import { client } from '../api.js';
import { StyleSheet, Text, View } from 'react-native';
import { t } from '../i18n.js';
import { color, space, type as typeScale } from '../theme.js';
import { Body, Button, Card, ErrorText, Heading, Pill, Row, Screen, Title } from '../ui.js';
import { useViewfinder } from '../viewfinder.js';
import type { CaptureSource } from './CaptureScreen.js';

const ROLE_KEY: Record<TagRole, MessageKey> = { hunter: 'role.hunter', hider: 'role.hider' };

const STATUS_KEY: Record<CatchStatus, MessageKey> = {
  pending: 'tag.pending',
  confirmed: 'tag.confirmed',
  disputed: 'tag.disputed',
  overruled: 'tag.overruled',
};

/**
 * Photo Tag live play.
 *
 * Three things this screen deliberately does not do, all from docs/07: it never
 * names who is hunting you (only that someone is close), it never verifies a
 * catch itself, and it shows claims made against you so *you* can rule on them.
 * Peer confirmation is not a fallback for missing face recognition — it is the
 * only route consistent with our own privacy stance.
 */
export function TagScreen({
  gameId,
  teams,
  scattering = false,
  capture,
}: {
  gameId: string;
  teams: TeamSummary[];
  /** True while the scatter timer runs, before roles are revealed. */
  scattering?: boolean;
  capture: CaptureSource;
}) {
  // Nothing can be photographed while everyone is still scattering, so the
  // preview waits until play actually starts.
  useViewfinder(!scattering);
  const [brief, setBrief] = useState<TagBriefView | null>(null);
  const [claims, setClaims] = useState<CatchClaimView[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [nextBrief, nextClaims] = await Promise.all([
        client.getTagBrief(gameId),
        client.listCatchClaims(gameId),
      ]);
      setBrief(nextBrief);
      setClaims(nextClaims);
    } catch {
      setError(t('tag.failed'));
    }
  }, [gameId]);

  useEffect(() => {
    // Nothing to load while the scatter timer runs: roles are withheld and no
    // claim can exist yet, so asking would only be noise.
    if (!scattering) void refresh();
  }, [refresh, scattering]);

  /** Shoot the catch and claim it. Nothing scores until the target agrees. */
  async function claim(targetTeamId: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const { file, location } = await capture();
      const { photoId } = await client.capturePhoto(gameId, {
        teamId: brief!.teamId,
        location,
        file,
      });
      // The position is reported alongside so the other player's proximity
      // warning stays live; it is never shown to anyone directly.
      await client.reportTagPing(gameId, location);
      await client.claimCatch(gameId, { targetTeamId, photoId });
      setStatus(t('tag.claimed'));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('tag.failed'));
    } finally {
      setBusy(false);
    }
  }

  async function answer(catchId: string, confirm: boolean): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await client.answerCatchClaim(gameId, catchId, confirm);
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('tag.failed'));
    } finally {
      setBusy(false);
    }
  }

  if (scattering) {
    return (
      <Screen>
        <Title>{t('tag.title')}</Title>
        <Body muted>{t('tag.scatter')}</Body>
      </Screen>
    );
  }

  const targets = teams.filter((team) => team.teamId !== brief?.teamId);
  const shown = brief?.targetTeamId ? targets.filter((team) => team.teamId === brief.targetTeamId) : targets;

  return (
    <Screen scroll>
      <Title>{t('tag.title')}</Title>
      {error ? <ErrorText>{error}</ErrorText> : null}
      {status ? <Pill>{status}</Pill> : null}

      {brief?.role ? <Body muted>{t('tag.role', { role: t(ROLE_KEY[brief.role]) })}</Body> : null}
      {brief?.targetTeamName ? (
        <Body muted>{t('tag.target', { team: brief.targetTeamName })}</Body>
      ) : (
        <Body muted>{t('tag.noTarget')}</Body>
      )}
      {/* A boolean, never a name — see the module comment. */}
      {brief?.hunterNearby ? <Text style={styles.warning}>{t('tag.nearby')}</Text> : null}

      {shown.map((team) => (
        <Card key={team.teamId}>
          <Row>
            <Heading>{team.name}</Heading>
            <Button onPress={() => claim(team.teamId)}>{t('tag.claim')}</Button>
          </Row>
        </Card>
      ))}

      <Heading>{t('tag.claimsTitle')}</Heading>
      {claims.length === 0 ? <Body muted>{t('tag.noClaims')}</Body> : null}
      {claims.map((entry) => (
        <Card key={entry.catchId}>
          <Heading>{t('tag.claimedBy', { team: entry.hunterTeamName })}</Heading>
          <Body muted>{t(STATUS_KEY[entry.status])}</Body>
          {entry.status === 'pending' ? (
            <View style={styles.answers}>
              <View style={styles.half}>
                <Button onPress={() => answer(entry.catchId, true)}>{t('tag.confirm')}</Button>
              </View>
              <View style={styles.half}>
                <Button onPress={() => answer(entry.catchId, false)} tone="secondary">
                  {t('tag.dispute')}
                </Button>
              </View>
            </View>
          ) : null}
        </Card>
      ))}
    </Screen>
  );
}

/** Re-exported so the app root can key the screen off the config. */
export type { TagSubMode };

const styles = StyleSheet.create({
  // The proximity warning is the one thing on this screen that has to be seen
  // without being read, so it gets a colour nothing else uses.
  warning: { ...typeScale.heading, color: color.warning },
  answers: { flexDirection: 'row', gap: space.sm },
  half: { flex: 1 },
});
