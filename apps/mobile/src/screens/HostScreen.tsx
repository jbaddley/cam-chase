import { useEffect, useState } from 'react';
import { FormScreen } from './FormScreen.js';
import { Body, Button, Chip, ChoiceRow, ErrorText, Field, Pill, Title } from '../ui.js';
import { ApiError, type EntitlementView, type HostParticipation } from '@photochase/client';
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
const HOST_ROLES = ['create_team', 'judge', 'spectator'] as const;

const HOST_ROLE_KEY: Record<HostParticipation['type'], MessageKey> = {
  create_team: 'config.hostPlaying',
  judge: 'config.hostJudging',
  spectator: 'config.hostWatching',
};

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
  // Playing by default: hosting a game you are not in is the exception.
  const [hostRole, setHostRole] = useState<HostParticipation['type']>('create_team');
  const [hostTeamName, setHostTeamName] = useState('');
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

  const playing = hostRole === 'create_team';
  // Only a playing host needs a name; a judge has nothing to call themselves.
  const ready = !playing || hostTeamName.trim() !== '';

  async function create(): Promise<void> {
    // The server rejects a blank team name anyway; stopping here means the host
    // is told what is missing instead of shown an error from an API call.
    if (busy || !ready) return;
    setBusy(true);
    setError(null);
    try {
      const host: HostParticipation = playing
        ? { type: 'create_team', name: hostTeamName.trim() }
        : { type: hostRole };
      const { gameId, code, teamId } = await client.createGame(config, { host });
      // `role` stays 'host' whatever the membership says: it is what gates the
      // start button, and a judging host still runs the game.
      onHosting({ gameId, code, teamId, role: 'host' });
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
      <ChoiceRow label={label}>
        {options.map((option) => {
          const ok = allowed(option);
          return (
            <Chip
              key={String(option)}
              onPress={() => ok && onPick(option)}
              selected={option === value}
              disabled={!ok}
            >
              {format ? format(option) : String(option)}
            </Chip>
          );
        })}
      </ChoiceRow>
    );
  }

  return (
    <FormScreen
      action={
        <>
          <Button onPress={create} disabled={!ready}>
            {busy ? t('config.creating') : t('config.create')}
          </Button>
          {onViewPlan ? (
            <Button onPress={onViewPlan} tone="secondary">
              {t('plan.title')}
            </Button>
          ) : null}
          <Button onPress={onCancel} tone="secondary">
            {t('common.back')}
          </Button>
        </>
      }
    >
      <Title>{t('config.title')}</Title>
      {entitlement ? <Pill>{t('plan.currentTier', { tier: entitlement.tier })}</Pill> : null}
      {error ? <ErrorText>{error}</ErrorText> : null}

        {/* First, because it is about the person rather than the game, and
            because a host who is never asked ends up stuck in the lobby. */}
        <Choices
          label={t('config.hostRole')}
          options={HOST_ROLES}
          value={hostRole}
          allowed={() => true}
          onPick={setHostRole}
          format={(role) => t(HOST_ROLE_KEY[role])}
        />
        {playing ? (
          <Field
            label={t('config.hostTeam')}
            value={hostTeamName}
            onChangeText={setHostTeamName}
            placeholder={t('join.teamName')}
            maxLength={40}
          />
        ) : (
          <Body muted>{t('config.hostRoleHint')}</Body>
        )}
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
        {limits && !limits.configurableRounds ? <Body muted>{t('config.locked')}</Body> : null}
    </FormScreen>
  );
}

