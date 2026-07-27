import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ApiError, type EntitlementView } from '@photochase/client';
import {
  COLOR_SPECIFICITIES,
  FREE_CONFIG,
  HUNT_THEMES,
  TAG_SUB_MODES,
  type GameConfig,
  type GameMode,
  type GameType,
  type ColorSpecificity,
  type HuntTheme,
  type TagSubMode,
} from '@photochase/shared';
import { client } from '../api.js';
import { t } from '../i18n.js';
import type { MessageKey } from '@photochase/i18n';
import type { JoinedGame } from './JoinScreen.js';

const TEAM_CHOICES = [2, 3, 4, 5, 6];
const PHOTO_CHOICES = [5, 8, 10, 15, 20];
const MINUTE_CHOICES = [5, 10, 15, 20];
const JUDGE_WEIGHT_CHOICES = [1, 2, 3, 4, 5];
const GAME_TYPES: GameType[] = ['round_robin', 'random', 'relay', 'decoy'];
const MODES: GameMode[] = ['photo_chase', 'scavenger_hunt', 'color_hunt', 'photo_tag'];

/** Catalog key per mode, so the picker follows the active locale. */
const MODE_KEY: Record<GameMode, MessageKey> = {
  photo_chase: 'mode.photoChase',
  scavenger_hunt: 'mode.scavengerHunt',
  color_hunt: 'mode.colorHunt',
  photo_tag: 'mode.photoTag',
};

/** Catalog key per colour-hunt difficulty, mirroring {@link MODE_KEY}. */
const LEVEL_KEY: Record<ColorSpecificity, MessageKey> = {
  simple: 'colorLevel.simple',
  color_plus: 'colorLevel.color_plus',
};

/** Catalog key per tag style, mirroring {@link MODE_KEY}. */
const TAG_MODE_KEY: Record<TagSubMode, MessageKey> = {
  pure_finder: 'tagMode.pure_finder',
  hide_seek: 'tagMode.hide_seek',
  dual: 'tagMode.dual',
};

/** Catalog key per hunt theme, mirroring {@link MODE_KEY}. */
const THEME_KEY: Record<HuntTheme, MessageKey> = {
  mixed: 'huntTheme.mixed',
  outdoors: 'huntTheme.outdoors',
  city: 'huntTheme.city',
  household: 'huntTheme.household',
  silly: 'huntTheme.silly',
};

/**
 * Host a game, with the settings the caller's plan actually permits.
 *
 * Options beyond the plan are shown greyed rather than hidden: a host should
 * see what upgrading would buy them. The server re-checks the config against
 * the entitlement regardless, so this is a UX affordance, not the gate.
 */
export function HostScreen({
  onHosting,
  onCancel,
  onViewPlan,
}: {
  onHosting: (game: JoinedGame) => void;
  onCancel: () => void;
  onViewPlan?: () => void;
}) {
  const [entitlement, setEntitlement] = useState<EntitlementView | null>(null);
  const [config, setConfig] = useState<GameConfig>(FREE_CONFIG);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    client
      .getEntitlement()
      .then((view) => {
        if (!active) return;
        setEntitlement(view);
        // Never start above the plan's team cap; the server would reject it.
        setConfig((c) => ({ ...c, maxTeams: Math.min(c.maxTeams, view.limits.maxTeams) }));
      })
      .catch(() => {
        if (active) setError(t('plan.failed'));
      });
    return () => {
      active = false;
    };
  }, []);

  const limits = entitlement?.limits;
  const isChase = config.mode === 'photo_chase';
  const isHunt = config.mode === 'scavenger_hunt';
  const isColor = config.mode === 'color_hunt';
  const isTag = config.mode === 'photo_tag';
  const allows = {
    // Modes come from the entitlement, not the tier alone: some are earned.
    // Tolerate a missing list rather than crash the only route to a new game.
    mode: (m: GameMode) => !entitlement?.modes || entitlement.modes.includes(m),
    teams: (n: number) => !limits || n <= limits.maxTeams,
    rounds: () => !limits || limits.configurableRounds,
    gameType: (type: GameType) => !limits || limits.allowedGameTypes.includes(type),
    judgeWeight: (n: number) => !limits || n <= limits.maxJudgeWeight,
  };

  async function create(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { gameId, code } = await client.createGame(config);
      onHosting({ gameId, code, teamId: null, role: 'host' });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('config.failed'));
    } finally {
      setBusy(false);
    }
  }

  /** A row of choices; disallowed ones render muted and do nothing on press. */
  function Choices<T extends string | number>({
    label,
    options,
    value,
    allowed,
    onPick,
    format,
  }: {
    label: string;
    options: readonly T[];
    value: T;
    allowed: (option: T) => boolean;
    onPick: (option: T) => void;
    format?: (option: T) => string;
  }) {
    return (
      <View style={styles.field}>
        <Text style={styles.label}>{label}</Text>
        <View style={styles.options}>
          {options.map((option) => {
            const ok = allowed(option);
            return (
              <Pressable
                key={String(option)}
                onPress={() => ok && onPick(option)}
                style={!ok ? styles.optionLocked : option === value ? styles.optionPicked : styles.option}
              >
                <Text style={ok ? undefined : styles.mutedText}>{format ? format(option) : String(option)}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('config.title')}</Text>
      {entitlement ? (
        <Text style={styles.subtitle}>{t('plan.currentTier', { tier: entitlement.tier })}</Text>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <ScrollView>
        <Choices
          label={t('config.mode')}
          options={MODES}
          value={config.mode}
          allowed={allows.mode}
          onPick={(mode) => setConfig((c) => ({ ...c, mode }))}
          format={(mode) => t(MODE_KEY[mode])}
        />
        {/* Which pool the list is drawn from — a hunt concept, nothing else's. */}
        {isHunt ? (
          <Choices
            label={t('config.huntTheme')}
            options={HUNT_THEMES}
            value={config.huntTheme ?? 'mixed'}
            allowed={() => true}
            onPick={(huntTheme) => setConfig((c) => ({ ...c, huntTheme }))}
            format={(theme) => t(THEME_KEY[theme])}
          />
        ) : null}
        {/* How specific the guess has to be — a colour-hunt concept only. */}
        {isColor ? (
          <Choices
            label={t('config.colorSpecificity')}
            options={COLOR_SPECIFICITIES}
            value={config.colorSpecificity ?? 'simple'}
            allowed={() => true}
            onPick={(colorSpecificity) => setConfig((c) => ({ ...c, colorSpecificity }))}
            format={(level) => t(LEVEL_KEY[level])}
          />
        ) : null}
        {/* Which of the three live-play variants — a tag concept only. */}
        {isTag ? (
          <Choices
            label={t('config.tagSubMode')}
            options={TAG_SUB_MODES}
            value={config.tagSubMode ?? 'pure_finder'}
            allowed={() => true}
            onPick={(tagSubMode) => setConfig((c) => ({ ...c, tagSubMode }))}
            format={(sub) => t(TAG_MODE_KEY[sub])}
          />
        ) : null}
        <Choices
          label={t('config.teams')}
          options={TEAM_CHOICES}
          value={config.maxTeams}
          allowed={allows.teams}
          onPick={(maxTeams) => setConfig((c) => ({ ...c, maxTeams }))}
        />
        <Choices
          label={t('config.photos')}
          options={PHOTO_CHOICES}
          value={config.photosPerRound}
          allowed={allows.rounds}
          onPick={(photosPerRound) => setConfig((c) => ({ ...c, photosPerRound }))}
        />
        <Choices
          label={t('config.minutes')}
          options={MINUTE_CHOICES}
          value={config.round1Minutes}
          allowed={allows.rounds}
          onPick={(minutes) => setConfig((c) => ({ ...c, round1Minutes: minutes, round2Minutes: minutes }))}
        />
        {/* Assignment strategy is a Round 2 concept, so only the chase has it. */}
        {isChase ? (
          <Choices
            label={t('config.gameType')}
            options={GAME_TYPES}
            value={config.gameType}
            allowed={allows.gameType}
            onPick={(gameType) => setConfig((c) => ({ ...c, gameType }))}
            format={(type) => type.replace('_', ' ')}
          />
        ) : null}
        <Choices
          label={t('config.judgeWeight')}
          options={JUDGE_WEIGHT_CHOICES}
          value={config.judgeWeight}
          allowed={allows.judgeWeight}
          onPick={(judgeWeight) => setConfig((c) => ({ ...c, judgeWeight }))}
          format={(n) => `${n}x`}
        />
        {limits && !limits.configurableRounds ? <Text style={styles.mutedText}>{t('config.locked')}</Text> : null}
      </ScrollView>

      <Pressable onPress={create} style={styles.button}>
        <Text>{busy ? t('config.creating') : t('config.create')}</Text>
      </Pressable>
      {onViewPlan ? (
        <Pressable onPress={onViewPlan} style={styles.secondary}>
          <Text>{t('plan.upgrade')}</Text>
        </Pressable>
      ) : null}
      <Pressable onPress={onCancel} style={styles.secondary}>
        <Text>{t('common.back')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 8 },
  title: { fontSize: 28, fontWeight: '700' },
  subtitle: { color: '#1971c2' },
  error: { color: '#c92a2a' },
  field: { paddingVertical: 10, gap: 6 },
  label: { fontSize: 16 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: { backgroundColor: '#e9ecef', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8 },
  optionPicked: { backgroundColor: '#ffd43b', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8 },
  optionLocked: { backgroundColor: '#f8f9fa', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8, opacity: 0.5 },
  mutedText: { color: '#adb5bd' },
  button: { backgroundColor: '#ffd43b', padding: 16, borderRadius: 12, alignItems: 'center' },
  secondary: { padding: 16, borderRadius: 12, alignItems: 'center' },
});
