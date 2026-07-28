import { useEffect, useState } from 'react';
import { ApiError, type FinalsView } from '@photochase/client';
import { client } from '../api.js';
import { Body, Chip, ChoiceRow, ErrorText, Loading, Screen, Title } from '../ui.js';

/**
 * Finals voting: pick a winner per category. The server rejects voting for your
 * own team, so those buttons are disabled here rather than failing on tap.
 */
export function FinalsScreen({ gameId, myTeamId }: { gameId: string; myTeamId: string | null }) {
  const [finals, setFinals] = useState<FinalsView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    client
      .getFinals(gameId)
      .then((f) => {
        if (active) setFinals(f);
      })
      .catch(() => {
        if (active) setError('Could not load the finals ballot.');
      });
    return () => {
      active = false;
    };
  }, [gameId]);

  async function vote(category: string, teamId: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await client.castFinalsVote(gameId, { category, teamId });
      setFinals((f) => (f ? { ...f, myVotes: { ...f.myVotes, [category]: teamId } } : f));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save that vote.');
    } finally {
      setBusy(false);
    }
  }

  if (!finals) {
    return (
      <Loading title="Finals" message={error ?? 'Loading the ballot…'} />
    );
  }

  const voted = finals.categories.filter((c) => finals.myVotes[c.id]).length;

  return (
    <Screen scroll>
      <Title>Finals</Title>
      <Body muted>
        {voted} / {finals.categories.length} categories voted
      </Body>
      {error ? <ErrorText>{error}</ErrorText> : null}
      {finals.categories.map((category) => (
        <ChoiceRow key={category.id} label={category.label}>
          {finals.teams.map((team) => {
            const own = team.teamId === myTeamId;
            return (
              <Chip
                key={team.teamId}
                onPress={() => !own && vote(category.id, team.teamId)}
                selected={finals.myVotes[category.id] === team.teamId}
                disabled={own}
              >
                {own ? `${team.name} (yours)` : team.name}
              </Chip>
            );
          })}
        </ChoiceRow>
      ))}
    </Screen>
  );
}

