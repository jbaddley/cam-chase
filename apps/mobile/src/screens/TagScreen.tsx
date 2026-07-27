import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ApiError, type CatchClaimView, type TagBriefView, type TeamSummary } from '@photochase/client';
import type { CatchStatus, TagRole, TagSubMode } from '@photochase/shared';
import type { MessageKey } from '@photochase/i18n';
import { client } from '../api.js';
import { t } from '../i18n.js';
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
      <View style={styles.container}>
        <Text style={styles.title}>{t('tag.title')}</Text>
        <Text style={styles.brief}>{t('tag.scatter')}</Text>
      </View>
    );
  }

  const targets = teams.filter((team) => team.teamId !== brief?.teamId);
  const shown = brief?.targetTeamId ? targets.filter((team) => team.teamId === brief.targetTeamId) : targets;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('tag.title')}</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {status ? <Text style={styles.status}>{status}</Text> : null}

      {brief?.role ? <Text style={styles.brief}>{t('tag.role', { role: t(ROLE_KEY[brief.role]) })}</Text> : null}
      {brief?.targetTeamName ? (
        <Text style={styles.brief}>{t('tag.target', { team: brief.targetTeamName })}</Text>
      ) : (
        <Text style={styles.brief}>{t('tag.noTarget')}</Text>
      )}
      {/* A boolean, never a name — see the module comment. */}
      {brief?.hunterNearby ? <Text style={styles.warning}>{t('tag.nearby')}</Text> : null}

      <ScrollView>
        {shown.map((team) => (
          <View key={team.teamId} style={styles.row}>
            <Text style={styles.teamName}>{team.name}</Text>
            <Pressable onPress={() => claim(team.teamId)} style={styles.button}>
              <Text>{t('tag.claim')}</Text>
            </Pressable>
          </View>
        ))}

        <Text style={styles.section}>{t('tag.claimsTitle')}</Text>
        {claims.length === 0 ? <Text style={styles.brief}>{t('tag.noClaims')}</Text> : null}
        {claims.map((entry) => (
          <View key={entry.catchId} style={styles.claim}>
            <Text style={styles.teamName}>{t('tag.claimedBy', { team: entry.hunterTeamName })}</Text>
            <Text style={styles.brief}>{t(STATUS_KEY[entry.status])}</Text>
            {entry.status === 'pending' ? (
              <View style={styles.answers}>
                <Pressable onPress={() => answer(entry.catchId, true)} style={styles.button}>
                  <Text>{t('tag.confirm')}</Text>
                </Pressable>
                <Pressable onPress={() => answer(entry.catchId, false)} style={styles.secondary}>
                  <Text>{t('tag.dispute')}</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

/** Re-exported so the app root can key the screen off the config. */
export type { TagSubMode };

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 8 },
  title: { fontSize: 28, fontWeight: '700' },
  brief: { fontSize: 16, color: '#666' },
  warning: { fontSize: 18, fontWeight: '700', color: '#e8590c' },
  error: { color: '#c92a2a' },
  status: { color: '#1971c2' },
  section: { fontSize: 20, fontWeight: '700', paddingTop: 20 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10 },
  claim: { paddingVertical: 12, gap: 6 },
  teamName: { fontSize: 18 },
  answers: { flexDirection: 'row', gap: 8 },
  button: { backgroundColor: '#ffd43b', paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10 },
  secondary: { backgroundColor: '#e9ecef', paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10 },
});
