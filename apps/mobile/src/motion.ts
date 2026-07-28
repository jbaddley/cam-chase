import { useEffect, useRef, useState } from 'react';

/** How long a score takes to climb to its final value. */
export const COUNT_UP_MS = 900;

/** Steps per second. Fast enough to read as motion, cheap enough to be free. */
const FRAMES_PER_SECOND = 30;

/**
 * Ease-out cubic: quick off the mark, settling into the final number rather
 * than stopping dead on it. A linear count reads like a progress bar; this
 * reads like a result landing.
 */
function easeOut(t: number): number {
  return 1 - (1 - t) ** 3;
}

/**
 * Count from zero up to `target`.
 *
 * Deliberately a timer over an integer rather than `Animated`: the thing being
 * animated is *text*, and Animated cannot drive text content — it drives style.
 * Any version of this ends up setting state on a schedule, so it may as well be
 * plain, testable, and identical on both platforms.
 *
 * `enabled` is for the case where there is nothing to celebrate yet; a score
 * that counts up before the scoreboard has loaded animates from zero to zero.
 */
export function useCountUp(target: number, enabled = true): number {
  const [value, setValue] = useState(enabled ? 0 : target);
  // Kept in a ref so the interval always sees the current goal without being
  // torn down and restarted on every render.
  const goal = useRef(target);
  goal.current = target;

  useEffect(() => {
    if (!enabled) {
      setValue(target);
      return;
    }

    const started = Date.now();
    setValue(0);

    const timer = setInterval(() => {
      const elapsed = Date.now() - started;
      if (elapsed >= COUNT_UP_MS) {
        // Land exactly on the target: an eased fraction of it would be off by
        // a point, and a scoreboard that disagrees with itself is worse than
        // one that does not move.
        setValue(goal.current);
        clearInterval(timer);
        return;
      }
      setValue(Math.round(goal.current * easeOut(elapsed / COUNT_UP_MS)));
    }, 1000 / FRAMES_PER_SECOND);

    return () => clearInterval(timer);
  }, [target, enabled]);

  return value;
}
