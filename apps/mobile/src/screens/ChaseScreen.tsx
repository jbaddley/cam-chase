import { useEffect, useState } from 'react';
import { ApiError, type AssignmentView } from '@photochase/client';
import { client } from '../api.js';
import { CaptureError } from '../capture.js';
import { t } from '../i18n.js';
import { useSignedPhoto } from '../useSignedPhoto.js';
import { Body, Button, Chip, ChoiceRow, ErrorText, Loading, Pill, Row } from '../ui.js';
import { useCameraPlacement, useViewfinder, useViewfinderLayout } from '../viewfinder.js';
import { placementFor } from '../viewport.js';
import { ChaseView, OVERLAY_LEVELS, type ChaseViewMode } from './ChaseView.js';
import { ViewfinderFrame } from './ViewfinderFrame.js';
import type { CaptureSource } from './CaptureScreen.js';

/**
 * Round 2: recreate the photos assigned to your team, one at a time.
 *
 * The original is the entire point of the round and this screen used to render
 * its caption — "Recreate photo #2" — over a live camera, with no way to see the
 * photograph being recreated. `ChaseView` shows it; the controls here choose how.
 * The default is `overlay`, because arriving on this screen the first thing you
 * want is to see the thing you are matching.
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
  /** Forwarded to the frame; defaults to the window. Passed by tests. */
  landscape?: boolean;
}) {
  useViewfinder();
  const [queue, setQueue] = useState<AssignmentView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ChaseViewMode>('overlay');
  const [opacity, setOpacity] = useState<number>(0.4);

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
      // Mark it chased locally so the queue advances to the next assignment.
      setQueue(
        (q) => q?.map((a) => (a.assignmentId === current.assignmentId ? { ...a, chasePhotoId } : a)) ?? q,
      );
    } catch (e) {
      // A `CaptureError` names something the player can act on, so it is
      // shown rather than flattened into the generic retry text.
      setError(e instanceof ApiError || e instanceof CaptureError ? e.message : t('chase.failed'));
    } finally {
      setBusy(false);
    }
  }

  if (!queue) return <Loading title={t('chase.title')} message={error ?? t('chase.loading')} />;

  return (
    <ViewfinderFrame
      landscape={landscape}
      backdrop={<ChaseView uri={uri} mode={mode} opacity={opacity} />}
      action={
        <Button onPress={chase} disabled={!current}>
          {!current ? t('chase.done') : busy ? t('chase.saving') : t('chase.take')}
        </Button>
      }
    >
      <ChaseInfo
        chased={chased}
        total={total}
        current={current}
        mode={mode}
        opacity={opacity}
        failed={failed}
        error={error}
        onMode={setMode}
        onOpacity={setOpacity}
      />
    </ViewfinderFrame>
  );
}

/**
 * The readout and the view controls.
 *
 * The controls collapse, and that is the whole point of this component's shape.
 * Two mode chips plus four level chips plus their labels is a slab, and the frame
 * puts the readout over the top of the picture — so left open they cover exactly
 * the part of the scene you are trying to line the shot up against, which is the
 * one thing this screen exists to let you see. `ViewfinderFrame`'s own docblock
 * says the middle stays empty; a settings panel parked over it does not.
 *
 * Collapsed, they are a single chip that states where the original currently
 * stands — "Original at 80%", "Original hidden" — so the setting is still legible
 * at a glance and one tap from being changed. Hidden, but not a secret.
 *
 * They stay open once opened, rather than closing on each pick: choosing a level
 * is something you do two or three times in a row while watching the overlay
 * settle, and a panel that shut itself after each tap would be worse than one
 * that never closed.
 *
 * Split from the screen so the layout hook is read inside the frame that provides
 * it — side by side is only offered when the phone is actually turned, since half
 * a portrait screen is not a useful comparison.
 */
function ChaseInfo({
  chased,
  total,
  current,
  mode,
  opacity,
  failed,
  error,
  onMode,
  onOpacity,
}: {
  chased: number;
  total: number;
  current: AssignmentView | null;
  mode: ChaseViewMode;
  opacity: number;
  failed: boolean;
  error: string | null;
  onMode: (mode: ChaseViewMode) => void;
  onOpacity: (opacity: number) => void;
}) {
  const { landscape } = useViewfinderLayout();
  const [open, setOpen] = useState(false);
  // Declared from here because this is inside the frame, so it is the first place
  // that knows both the mode and which way the phone is held.
  useCameraPlacement(placementFor(mode, landscape));

  const modes: Array<{ value: ChaseViewMode; label: string }> = [
    { value: 'hidden', label: t('chase.hide') },
    { value: 'overlay', label: t('chase.overlay') },
    // One idea — "show me both at once" — arranged by how the phone is held
    // rather than offered as two choices the player has to understand.
    { value: 'split' as const, label: landscape ? t('chase.sideBySide') : t('chase.topAndBottom') },
  ];

  /** What the collapsed chip says: the state, not the verb. */
  const summary =
    mode === 'hidden'
      ? t('chase.viewHidden')
      : mode === 'split'
        ? landscape
          ? t('chase.sideBySide')
          : t('chase.topAndBottom')
        : t('chase.overlayAt', { percent: Math.round(opacity * 100) });

  return (
    <>
      <Body muted>{t('chase.progress', { chased, total })}</Body>
      <Pill>
        {current ? t('chase.recreate', { number: current.order + 1 }) : t('chase.allDone')}
      </Pill>
      {error ? <ErrorText>{error}</ErrorText> : null}
      {failed ? <ErrorText>{t('chase.originalUnavailable')}</ErrorText> : null}

      {current ? (
        <>
          {/* Collapsed: one chip, stating where the original stands. */}
          <Row>
            <Chip onPress={() => setOpen(!open)} selected={open}>
              {open ? t('chase.hideControls') : summary}
            </Chip>
          </Row>

          {open ? (
            <>
              <ChoiceRow label={t('chase.original')}>
                {modes.map((m) => (
                  <Chip key={m.value} onPress={() => onMode(m.value)} selected={mode === m.value}>
                    {m.label}
                  </Chip>
                ))}
              </ChoiceRow>

              {/* The level is words rather than a bar because the harness drops
                  styles: an overlay at 25% and one at 75% are the same DOM, so
                  this is both the readable label and the only assertable one. */}
              {mode === 'overlay' ? (
                <ChoiceRow label={t('chase.overlayAt', { percent: Math.round(opacity * 100) })}>
                  {OVERLAY_LEVELS.map((level) => (
                    <Chip key={level} onPress={() => onOpacity(level)} selected={opacity === level}>
                      {`${Math.round(level * 100)}%`}
                    </Chip>
                  ))}
                </ChoiceRow>
              ) : null}

    
            </>
          ) : null}
        </>
      ) : null}
    </>
  );
}
