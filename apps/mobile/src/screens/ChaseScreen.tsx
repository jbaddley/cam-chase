import { useEffect, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { ApiError, type AssignmentView } from '@photochase/client';
import { client } from '../api.js';
import { CaptureError } from '../capture.js';
import { t } from '../i18n.js';
import { space } from '../theme.js';
import { useSignedPhoto } from '../useSignedPhoto.js';
import { Body, Button, Chip, ChoiceRow, ErrorText, Heading, IconButton, Loading, Sheet } from '../ui.js';
import { useCameraPlacement, useViewfinder } from '../viewfinder.js';
import { placementFor } from '../viewport.js';
import { ChaseView, OVERLAY_LEVELS, type ChaseViewMode } from './ChaseView.js';
import type { CaptureSource } from './CaptureScreen.js';

/**
 * Round 2: recreate the photos assigned to your team, one at a time.
 *
 * Three zones, and nothing crosses between them (docs/10). The header carries the
 * readout and the way to the options; the middle is the viewfinder and the photo
 * and holds nothing else; one shutter sits in the lower third. The view options
 * live in a sheet, because they are set once or twice and then ignored, and a
 * control being ignored should not be occupying the picture.
 *
 * This screen reached that shape by three wrong turns — a settings slab across the
 * frame, then chips across it, then a collapsed chip still on it. The frame was
 * never the place for them.
 */
export function ChaseScreen({
  gameId,
  teamId,
  capture,
  landscape,
}: {
  gameId: string;
  teamId: string;
  capture: CaptureSource;
  /** Defaults to the window; passed explicitly by tests. */
  landscape?: boolean;
}) {
  useViewfinder();
  const window = useWindowDimensions();
  const wide = landscape ?? window.width > window.height;

  const [queue, setQueue] = useState<AssignmentView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ChaseViewMode>('overlay');
  const [opacity, setOpacity] = useState<number>(0.4);
  const [options, setOptions] = useState(false);

  useCameraPlacement(placementFor(mode, wide));

  useEffect(() => {
    let active = true;
    client
      .listAssignments(gameId)
      .then((q) => {
        if (active) setQueue(q);
      })
      .catch(() => {
        if (active) setError(t('chase.loadFailed'));
      });
    return () => {
      active = false;
    };
  }, [gameId]);

  const current = queue?.find((a) => a.chasePhotoId === null) ?? null;
  const chased = queue?.filter((a) => a.chasePhotoId !== null).length ?? 0;
  const total = queue?.length ?? 0;

  const { uri, failed } = useSignedPhoto(gameId, current?.originalPhotoId ?? null);

  async function chase(): Promise<void> {
    if (busy || !current) return;
    setBusy(true);
    setError(null);
    try {
      const { file, location } = await capture();
      const { chasePhotoId } = await client.captureChase(gameId, {
        teamId,
        assignmentId: current.assignmentId,
        location,
        file,
      });
      setQueue(
        (q) => q?.map((a) => (a.assignmentId === current.assignmentId ? { ...a, chasePhotoId } : a)) ?? q,
      );
    } catch (e) {
      setError(e instanceof ApiError || e instanceof CaptureError ? e.message : t('chase.failed'));
    } finally {
      setBusy(false);
    }
  }

  if (!queue) return <Loading title={t('chase.title')} message={error ?? t('chase.loading')} />;

  /** Where the original currently stands, stated rather than named as a verb. */
  const summary =
    mode === 'hidden'
      ? t('chase.viewHidden')
      : mode === 'split'
        ? wide
          ? t('chase.sideBySide')
          : t('chase.topAndBottom')
        : t('chase.overlayAt', { percent: Math.round(opacity * 100) });

  return (
    <View style={styles.screen}>
      <ChaseHeader
        chased={chased}
        total={total}
        current={current}
        summary={summary}
        onOpen={() => setOptions(true)}
      />

      {/* Content: the camera square sits behind this, and the original is drawn
          over or beside it. Nothing else is. */}
      <View style={styles.content}>
        <ChaseView uri={uri} mode={mode} opacity={opacity} landscape={wide} />
      </View>

      <View style={styles.action}>
        {error ? <ErrorText>{error}</ErrorText> : null}
        {failed ? <ErrorText>{t('chase.originalUnavailable')}</ErrorText> : null}
        <Button onPress={chase} disabled={!current}>
          {!current ? t('chase.done') : busy ? t('chase.saving') : t('chase.take')}
        </Button>
      </View>

      <ChaseOptions
        visible={options}
        mode={mode}
        opacity={opacity}
        landscape={wide}
        onMode={setMode}
        onOpacity={setOpacity}
        onClose={() => setOptions(false)}
      />
    </View>
  );
}

/**
 * The header: what round you are on, how far through, and the way to the options.
 *
 * Everything the old inline panel carried lives here or in the sheet, because
 * nothing belongs on top of the picture (docs/10). The readout is chrome, the
 * gear is a secondary action, and the viewfinder is the content.
 */
function ChaseHeader({
  chased,
  total,
  current,
  summary,
  onOpen,
}: {
  chased: number;
  total: number;
  current: AssignmentView | null;
  summary: string;
  onOpen: () => void;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.headerText}>
        <Body muted>{t('chase.progress', { chased, total })}</Body>
        <Heading>
          {current ? t('chase.recreate', { number: current.order + 1 }) : t('chase.allDone')}
        </Heading>
        <Body muted>{summary}</Body>
      </View>
      {current ? (
        <IconButton
          glyph="⚙"
          onPress={onOpen}
          accessibilityLabel={t('chase.viewOptions')}
          testID="chase-options"
        />
      ) : null}
    </View>
  );
}

/** The view options, in a sheet, opened from the header and closed with Done. */
function ChaseOptions({
  visible,
  mode,
  opacity,
  landscape,
  onMode,
  onOpacity,
  onClose,
}: {
  visible: boolean;
  mode: ChaseViewMode;
  opacity: number;
  landscape: boolean;
  onMode: (mode: ChaseViewMode) => void;
  onOpacity: (opacity: number) => void;
  onClose: () => void;
}) {
  const modes: Array<{ value: ChaseViewMode; label: string }> = [
    { value: 'hidden', label: t('chase.hide') },
    { value: 'overlay', label: t('chase.overlay') },
    // One idea — show me both at once — named for the arrangement in use rather
    // than offered as two separate choices.
    { value: 'split', label: landscape ? t('chase.sideBySide') : t('chase.topAndBottom') },
  ];

  return (
    <Sheet
      visible={visible}
      title={t('chase.viewOptions')}
      onClose={onClose}
      doneLabel={t('chase.hideControls')}
      dismissLabel={t('common.back')}
    >
      <ChoiceRow label={t('chase.original')}>
        {modes.map((m) => (
          <Chip key={m.value} onPress={() => onMode(m.value)} selected={mode === m.value}>
            {m.label}
          </Chip>
        ))}
      </ChoiceRow>

      {/* The level is words rather than a bar because the harness drops styles:
          an overlay at 25% and one at 75% are the same DOM, so this is both the
          readable label and the only assertable one. */}
      {mode === 'overlay' ? (
        <ChoiceRow label={t('chase.overlay')}>
          {OVERLAY_LEVELS.map((level) => (
            <Chip key={level} onPress={() => onOpacity(level)} selected={opacity === level}>
              {`${Math.round(level * 100)}%`}
            </Chip>
          ))}
        </ChoiceRow>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  /** Chrome: identity and secondary actions, never over the content. */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xl,
    paddingBottom: space.md,
    gap: space.md,
  },
  headerText: { flex: 1, gap: space.xs },
  /** The viewfinder and the photo. The camera square is positioned behind this. */
  content: { flex: 1 },
  /** One primary action, full width, in the lower third where a thumb reaches. */
  action: { paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.lg },
});
