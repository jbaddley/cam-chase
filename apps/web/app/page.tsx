import { TIER_LIMITS, TIERS } from '@photochase/shared';

/** Marketing landing page. Pricing rows are derived from the shared tier model. */
export default function HomePage() {
  return (
    <main>
      <h1>PhotoChase</h1>
      <p>Race out, snap the clue, strike the pose — then chase your rivals&rsquo; shots.</p>

      <h2>Plans</h2>
      <ul>
        {TIERS.map((tier) => {
          const limits = TIER_LIMITS[tier];
          return (
            <li key={tier}>
              <strong>{tier}</strong>: up to {limits.maxTeams} teams,{' '}
              {limits.allowAiJudging ? 'AI judging' : 'no AI'},{' '}
              {limits.gamesGranted === 'unlimited' ? 'unlimited games' : `${limits.gamesGranted} games`}
            </li>
          );
        })}
      </ul>

      <p>
        <a href="/watch">Open the big-screen viewer &rarr;</a>
      </p>
    </main>
  );
}
