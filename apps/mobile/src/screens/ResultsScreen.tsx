import { useEffect, useState, type ReactNode } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { MessageKey } from '@photochase/i18n';
import type { GameMode, TeamScore } from '@photochase/shared';
import type { ResultHighlight, TeamSummary } from '@photochase/client';
import { client } from '../api.js';
import { t } from '../i18n.js';
import { useCountUp } from '../motion.js';
import { useSignedPhoto } from '../useSignedPhoto.js';
import { color, radius, space, type as typeScale } from '../theme.js';
import { Button, Card, ErrorText, Heading, Loading, Pop, Screen, Title } from '../ui.js';

/**
 * Score components shown under each team's total, in scoring order.
 *
 * Every mode emits the same `TeamScore` so results, spectator view and league
 * standings work without knowing the mode — but the columns mean different
 * things, so only the labels vary. A colour hunt's `location` is guesses read
 * right and its `pose` is the bluff bonus; showing those as "Location" and
 * "Pose" would be actively misleading.
 */
const BREAKDOWN: Array<{ key: keyof TeamScore; label: string }> = [
  { key: 'location', label: 'Location' },
  { key: 'pose', label: 'Pose' },
  { key: 'angle', label: 'Angle' },
  { key: 'timeBonus', label: 'Return bonus' },
  { key: 'bestMatchBonus', label: 'Best match' },
  { key: 'specialBonus', label: 'Special' },
  { key: 'foulPenalty', label: 'Fouls' },
];

/**
 * Per-mode overrides for the columns whose meaning changes, resolved through
 * `t()` at render so they follow the viewer's locale — the catalogue keys are
 * already translated in every locale, so a Spanish player sees "Aciertos", not
 * the English "Guessed right".
 *
 * `scavenger_hunt`'s "Items found" has no catalogue key yet, so it stays an
 * English literal below until one lands (see docs/i18n-gap-audit.md). The base
 * BREAKDOWN labels are likewise not yet keyed.
 */
const MODE_LABEL_KEYS: Partial<Record<GameMode, Partial<Record<keyof TeamScore, MessageKey>>>> = {
  color_hunt: { location: 'score.guessedRight', pose: 'score.bluffBonus' },
  photo_tag: { location: 'score.catches', pose: 'score.survival' },
};
const MODE_LABEL_FALLBACKS: Partial<Record<GameMode, Partial<Record<keyof TeamScore, string>>>> = {
  scavenger_hunt: { location: 'Items found' },
};

/** Final standings with each team's score breakdown, highest total first. */
export function ResultsScreen({
  gameId,
  teams,
  mode = 'photo_chase',
}: {
  gameId: string;
  teams: TeamSummary[];
  mode?: GameMode;
}) {
  const [scoreboard, setScoreboard] = useState<TeamScore[] | null>(null);
  const [highlights, setHighlights] = useState<ResultHighlight[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState<boolean | null>(null);
  const [consentError, setConsentError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    client
      .getResults(gameId)
      .then(({ scoreboard: s, highlights: h }) => {
        if (!active) return;
        setScoreboard([...s].sort((a, b) => b.total - a.total));
        // `?? []` so a server that predates highlights (or the moment before the
        // deploy lands) shows the standings rather than crashing on undefined.
        setHighlights(h ?? []);
      })
      .catch(() => {
        if (active) setError('Could not load the results.');
      });
    return () => {
      active = false;
    };
  }, [gameId]);

  const nameOf = (teamId: string) => teams.find((team) => team.teamId === teamId)?.name ?? teamId;

  /**
   * Sharing consent is asked here, at the moment there is something worth
   * sharing, and it stays answerable both ways — a "yes" that cannot be taken
   * back is not consent (docs/07).
   */
  async function answerConsent(answer: boolean): Promise<void> {
    setConsentError(null);
    try {
      const { consent: saved } = await client.setSharingConsent(gameId, answer);
      setConsent(saved);
    } catch {
      setConsentError(t('share.consentFailed'));
    }
  }

  if (!scoreboard) {
    return (
      <Loading title="Results" message={error ?? 'Tallying scores…'} />
    );
  }

  const winner = scoreboard[0];

  return (
    <Screen>
      <Title>Results</Title>
      <ScrollView contentContainerStyle={styles.list}>
        {scoreboard.map((score, i) => (
          <View key={score.teamId} style={i === 0 ? styles.winnerWrap : undefined}>
            {/* Only the winner pops. Used on every row it would stop meaning
                anything, and the point is that first place arrives. */}
            <Maybe pop={i === 0}>
            <Card tone={i === 0 ? 'highlight' : 'plain'}>
              <View style={styles.headerRow}>
                <View style={styles.nameGroup}>
                  {/* A medal beats a number for the top three; everyone else
                      gets their placing, which is what they came to see. */}
                  <View style={[styles.medal, { backgroundColor: color.podium[i] ?? color.surfaceSunken }]}>
                    <Text style={styles.medalText}>{i + 1}</Text>
                  </View>
                  <Text style={i === 0 ? styles.winnerName : styles.teamName}>{nameOf(score.teamId)}</Text>
                </View>
                {i === 0 ? <WinnerTotal total={score.total} /> : <Text style={styles.total}>{score.total}</Text>}
              </View>
              {BREAKDOWN.filter(({ key }) => score[key] !== 0).map(({ key, label }) => {
                const overrideKey = MODE_LABEL_KEYS[mode]?.[key];
                const text = overrideKey ? t(overrideKey) : MODE_LABEL_FALLBACKS[mode]?.[key] ?? label;
                return (
                  <View key={key} style={styles.row}>
                    <Text style={styles.label}>{text}</Text>
                    <Text style={styles.value}>{score[key]}</Text>
                  </View>
                );
              })}
            </Card>
            </Maybe>
          </View>
        ))}
        {winner ? <Text style={styles.flourish}>🏆 {nameOf(winner.teamId)} takes it</Text> : null}

        {/* The shots that took each category, so the finish is something to look
            at, not just a column of totals. Absent when nobody voted. */}
        {highlights.length > 0 ? (
          <View style={styles.highlights}>
            <Heading>Category winners</Heading>
            {highlights.map((h) => (
              <Highlight key={h.category} gameId={gameId} h={h} />
            ))}
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.consent}>
        <Text style={styles.label}>{t('share.consentAsk')}</Text>
        <View style={styles.consentRow}>
          <View style={styles.consentButton}>
            <Button onPress={() => answerConsent(true)} tone={consent === true ? 'primary' : 'secondary'}>
              {t('share.consentYes')}
            </Button>
          </View>
          <View style={styles.consentButton}>
            <Button onPress={() => answerConsent(false)} tone={consent === false ? 'primary' : 'secondary'}>
              {t('share.consentNo')}
            </Button>
          </View>
        </View>
        {consentError ? <ErrorText>{consentError}</ErrorText> : null}
      </View>
    </Screen>
  );
}

/** Wraps in a {@link Pop} or leaves the child alone; keeps the JSX readable. */
function Maybe({ pop, children }: { pop: boolean; children: ReactNode }) {
  return pop ? <Pop>{children}</Pop> : <>{children}</>;
}

/**
 * The winning score, counted up.
 *
 * Its own component because the hook has to run unconditionally, and only the
 * top row animates — a whole scoreboard climbing at once is noise, and the
 * point is to draw the eye to first place.
 */
function WinnerTotal({ total }: { total: number }) {
  return <Text style={styles.winnerTotal}>{useCountUp(total)}</Text>;
}

/** One category's winner: the label, the team, and the shot that took it. */
function Highlight({ gameId, h }: { gameId: string; h: ResultHighlight }) {
  const original = useSignedPhoto(gameId, h.originalPhotoId ?? null);
  const recreation = useSignedPhoto(gameId, h.chasePhotoId ?? null);
  return (
    <Card>
      <Text style={styles.highlightLabel}>{h.label}</Text>
      <Heading>{h.teamName}</Heading>
      {h.chasePhotoId ? (
        <View style={styles.pair}>
          <HighlightFigure uri={original.uri} failed={original.failed} testID={`result-original-${h.category}`} />
          <HighlightFigure uri={recreation.uri} failed={recreation.failed} testID={`result-chase-${h.category}`} />
        </View>
      ) : null}
    </Card>
  );
}

function HighlightFigure({ uri, failed, testID }: { uri: string | null; failed: boolean; testID: string }) {
  return (
    <View style={styles.frame}>
      {uri ? (
        <Image testID={testID} source={{ uri }} resizeMode="cover" style={StyleSheet.absoluteFill} />
      ) : (
        <Text style={styles.placeholder}>{failed ? 'Unavailable' : '…'}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.md, paddingBottom: space.lg },
  /** The category-winners reel, below the standings. */
  highlights: { gap: space.md, paddingTop: space.md },
  highlightLabel: { ...typeScale.label, color: color.inkMuted },
  pair: { flexDirection: 'row', gap: space.sm, marginTop: space.xs },
  frame: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: color.surfaceSunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholder: { ...typeScale.label, color: color.inkMuted },
  winnerWrap: { marginBottom: space.xs },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  nameGroup: { flexDirection: 'row', alignItems: 'center', gap: space.md, flexShrink: 1 },
  medal: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  medalText: { ...typeScale.label, color: color.ink },
  teamName: { ...typeScale.heading, color: color.ink, flexShrink: 1 },
  winnerName: { ...typeScale.title, color: color.ink, flexShrink: 1 },
  total: { ...typeScale.heading, color: color.accent },
  winnerTotal: { ...typeScale.display, color: color.primaryDark },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingLeft: 46 },
  label: { ...typeScale.label, color: color.inkMuted },
  value: { ...typeScale.label, color: color.ink },
  flourish: { ...typeScale.heading, color: color.ink, textAlign: 'center', paddingTop: space.sm },
  consent: { gap: space.sm },
  consentRow: { flexDirection: 'row', gap: space.sm },
  consentButton: { flex: 1 },
});
