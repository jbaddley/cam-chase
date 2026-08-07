import { useCallback, useEffect, useRef, useState } from 'react';
import { type LayoutChangeEvent, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { ApiError, type AssignmentView } from '@photochase/client';
import { client } from '../api.js';
import { CaptureError } from '../capture.js';
import { useHideChrome } from '../chrome.js';
import { t } from '../i18n.js';
import { color, radius, space, type as typeScale } from '../theme.js';
import { useSignedPhoto } from '../useSignedPhoto.js';
import { Chip, ChoiceRow, ErrorText, IconButton, Loading, Sheet, ShutterButton } from '../ui.js';
import { useCameraRect, useViewfinder } from '../viewfinder.js';
import { layoutViewport, placementFor, type Rect } from '../viewport.js';
import { ChaseView, OVERLAY_LEVELS, type ChaseViewMode } from './ChaseView.js';
import type { CaptureSource } from './CaptureScreen.js';

/**
 * Round 2: recreate the photos assigned to your team, one at a time.
 *
 * The screen is one chrome layout in every mode (docs/10), designed for the
 * tightest case — two full squares side by side. A thin header carries the
 * readout and the way to the options; a single shutter sits in the lower third;
 * the whole band between them is the picture region and holds nothing else. Hide,
 * overlay and split all use that same region, so the chrome never moves.
 *
 * The region is *measured*, not assumed, and that is the fix for the mode that
 * was broken. The camera is a native layer positioned in window coordinates,
 * outside the safe area; this screen lives inside it. So the region is measured
 * twice off the same view — in UI space for the original drawn here, and in
 * window space for the camera drawn there — and one `layoutViewport` call lays
 * the squares out in each. Overlay then puts both on the identical pixels; split
 * gives each its own half of a region that was sized to hold both. Before this,
 * the camera laid out against the whole window while the header and shutter sat
 * in those pixels, so a split hid the square under the chrome and an overlay
 * could not line up.
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
  // Fullscreen: no header, no shutter, no game bar — the picture owns the whole
  // screen and a tap anywhere takes the shot. `useHideChrome` asks the shell to
  // pull its bar while this is on (and restores it on the way out).
  const [fullscreen, setFullscreen] = useState(false);
  useHideChrome(fullscreen);

  // The picture region, measured in the two coordinate spaces it has to serve:
  // `ui` for the original this screen draws, `window` for the camera the stage
  // draws (outside the safe area). `ui` is the region's *own* box (0,0,w,h), not
  // its offset in a parent, because the original is drawn in a layer *inside* the
  // region view — so however the region is nested (a column in portrait, a row in
  // landscape, a fullscreen surface), the original and the camera cannot drift.
  const [region, setRegion] = useState<{ ui: Rect; window: Rect } | null>(null);
  const regionRef = useRef<View | null>(null);
  const onRegion = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    const ui: Rect = { left: 0, top: 0, width, height };
    const node = regionRef.current;
    // measureInWindow gives absolute window coordinates, crossing the safe-area
    // inset the camera sits outside of. Absent under the DOM harness — fall back
    // to the UI box, where with no insets the two spaces coincide anyway.
    if (node && typeof node.measureInWindow === 'function') {
      node.measureInWindow((wx, wy, ww, wh) => setRegion({ ui, window: { left: wx, top: wy, width: ww, height: wh } }));
    } else {
      setRegion({ ui, window: ui });
    }
  }, []);

  // The largest square(s) the region holds, laid out once per space. Until the
  // region is measured, fall back to the whole window so the first frame — and
  // every DOM test — still has somewhere to put the original.
  const fallback: Rect = { left: 0, top: 0, width: window.width, height: window.height };
  const placement = placementFor(mode, wide);
  const viewport = layoutViewport(placement, region?.ui ?? fallback);
  const cameraRect = region ? layoutViewport(placement, region.window).camera : null;
  useCameraRect(cameraRect);

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

  /** The original, drawn in a layer inside whatever region view is mounted. */
  const picture = (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <ChaseView uri={uri} mode={mode} opacity={opacity} camera={viewport.camera} other={viewport.other} />
    </View>
  );

  return (
    <View style={styles.screen}>
      {fullscreen ? (
        /* The whole screen is the shutter: a tap anywhere shoots. The region is
           measured off this surface, so the squares fill the screen the bar and
           header have vacated. Exit is a small corner control (and a long hold),
           because everything else is deliberately gone. */
        <Pressable
          ref={regionRef}
          style={styles.region}
          onLayout={onRegion}
          onPress={() => void chase()}
          onLongPress={() => setFullscreen(false)}
          delayLongPress={450}
          disabled={!current || busy}
          accessibilityLabel={t('chase.take')}
          testID="chase-shoot"
        >
          {picture}
          <View style={styles.fsExit}>
            <IconButton
              glyph="✕"
              onPress={() => setFullscreen(false)}
              accessibilityLabel={t('chase.exitFullscreen')}
              testID="chase-shrink"
            />
          </View>
          {error ? <Text style={styles.fsError}>{error}</Text> : null}
          {/* The shutter, so there is a place to look and press; a tap anywhere
              still shoots, and a hold still exits. Bottom-centre upright, at the
              right edge when turned — where the thumb already is. */}
          <View style={wide ? styles.fsShutterSide : styles.fsShutterBottom} pointerEvents="box-none">
            <ShutterButton
              onPress={chase}
              disabled={!current}
              busy={busy}
              accessibilityLabel={busy ? t('chase.saving') : t('chase.take')}
              testID="chase-shutter"
            />
          </View>
        </Pressable>
      ) : (
        <>
          <ChaseHeader
            chased={chased}
            total={total}
            current={current}
            summary={summary}
            onOpen={() => setOptions(true)}
            onFullscreen={() => setFullscreen(true)}
          />

          {/* The picture region and the shutter. Stacked in portrait; turned side
              by side in landscape, so the short axis is not split between chrome
              and picture — the shutter takes a column at the edge and the picture
              keeps the height. */}
          <View style={[styles.middle, wide && styles.middleRow]}>
            <View ref={regionRef} style={styles.region} onLayout={onRegion} collapsable={false}>
              {picture}
            </View>

            <View style={[styles.action, wide && styles.actionSide]}>
              {error ? <ErrorText>{error}</ErrorText> : null}
              {failed ? <ErrorText>{t('chase.originalUnavailable')}</ErrorText> : null}
              <ShutterButton
                onPress={chase}
                disabled={!current}
                busy={busy}
                accessibilityLabel={!current ? t('chase.done') : busy ? t('chase.saving') : t('chase.take')}
                testID="chase-shutter"
              />
            </View>
          </View>
        </>
      )}

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
 * The header: what you are recreating, how far through, and the way to the
 * options — a thin strip, not a slab.
 *
 * This is a camera screen, so the picture gets the room and the chrome gets a
 * sliver: the subject and progress share one line and the mode sits under them
 * in a caption, where a full-size heading and three stacked lines used to push
 * the viewfinder a third of the way down the screen. Everything else the old
 * inline panel carried lives in the sheet (docs/10 — nothing over the picture).
 */
function ChaseHeader({
  chased,
  total,
  current,
  summary,
  onOpen,
  onFullscreen,
}: {
  chased: number;
  total: number;
  current: AssignmentView | null;
  summary: string;
  onOpen: () => void;
  onFullscreen: () => void;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.headerText}>
        <View style={styles.titleRow}>
          <Text style={styles.subject} numberOfLines={1}>
            {current ? t('chase.recreate', { number: current.order + 1 }) : t('chase.allDone')}
          </Text>
          <Text style={styles.progress} numberOfLines={1}>
            {t('chase.progress', { chased, total })}
          </Text>
        </View>
        <Text style={styles.summary} numberOfLines={1}>
          {summary}
        </Text>
      </View>
      {current ? (
        <View style={styles.headerActions}>
          <IconButton
            glyph="⛶"
            onPress={onFullscreen}
            accessibilityLabel={t('chase.fullscreen')}
            testID="chase-fullscreen"
          />
          <IconButton
            glyph="⚙"
            onPress={onOpen}
            accessibilityLabel={t('chase.viewOptions')}
            testID="chase-options"
          />
        </View>
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
  /** Chrome: a thin strip, never over the content and never more than it needs. */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xl,
    paddingTop: space.xs,
    paddingBottom: space.sm,
    gap: space.md,
  },
  headerText: { flex: 1, gap: 2 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  /** Subject and progress on one line; the mode a caption beneath. */
  titleRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  subject: { ...typeScale.body, fontWeight: '700', color: color.ink },
  progress: { ...typeScale.label, color: color.inkMuted },
  summary: { ...typeScale.label, color: color.inkMuted },
  /** Region + shutter: stacked upright, side by side when turned. */
  middle: { flex: 1, flexDirection: 'column' },
  middleRow: { flexDirection: 'row' },
  /** The picture region: it holds the picture layer and, in fullscreen, is the
      tap-to-shoot surface. The squares are laid out from its own measured box. */
  region: { flex: 1 },
  /** The shutter's zone. A round button needs little room, so the picture gets
      the rest: a slim strip along the bottom upright, a slim column at the
      trailing edge when turned (which is what makes side-by-side big). */
  action: { paddingTop: space.sm, paddingBottom: space.md, alignItems: 'center', gap: space.xs },
  actionSide: {
    width: 120,
    alignSelf: 'stretch',
    justifyContent: 'center',
    paddingBottom: 0,
    paddingHorizontal: space.sm,
  },
  /** Fullscreen shutter: bottom-centre upright, right-edge centred when turned. */
  fsShutterBottom: { position: 'absolute', left: 0, right: 0, bottom: space.xl, alignItems: 'center' },
  fsShutterSide: { position: 'absolute', top: 0, bottom: 0, right: space.xl, justifyContent: 'center' },
  /** Fullscreen: the one escape hatch, tucked in a corner and kept faint so it
      is findable without competing with the picture. */
  fsExit: { position: 'absolute', top: space.sm, right: space.sm, opacity: 0.7 },
  /** A quiet caption over the picture: what a tap does, and how to leave. */
  fsHint: {
    position: 'absolute',
    bottom: space.xl,
    alignSelf: 'center',
    ...typeScale.label,
    color: '#fff',
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  fsError: {
    position: 'absolute',
    bottom: space.xxl * 2,
    alignSelf: 'center',
    ...typeScale.label,
    color: '#fff',
    backgroundColor: color.danger,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
});
