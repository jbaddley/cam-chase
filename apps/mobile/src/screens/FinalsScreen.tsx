import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { ApiError, type FinalsView } from '@photochase/client';
import { client } from '../api.js';
import { color, radius, space, type as typeScale } from '../theme.js';
import { useSignedPhoto } from '../useSignedPhoto.js';
import { Body, Card, Chip, ChoiceRow, ErrorText, Heading, Loading, Screen, Title } from '../ui.js';

type FinalsTeam = FinalsView['teams'][number];

/**
 * Finals voting: pick a winner per category.
 *
 * Now you can see what you are voting on. The screen shipped as category rows of
 * team names over nothing — a "best overall match" vote with the matches
 * invisible. Each team's ballot entry is its best-rated recreation shown beside
 * the original it chased (`pickFinalists` on the server), so a vote is a
 * judgement of the work rather than a guess at a name.
 *
 * The server rejects voting for your own team, so those chips are disabled here
 * rather than failing on tap.
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
    return <Loading title="Finals" message={error ?? 'Loading the ballot…'} />;
  }

  const voted = finals.categories.filter((c) => finals.myVotes[c.id]).length;

  return (
    <Screen scroll>
      <Title>Finals</Title>
      <Body muted>
        {voted} / {finals.categories.length} categories voted
      </Body>
      {error ? <ErrorText>{error}</ErrorText> : null}

      {/* The matchups first, so the vote below is something you looked at. */}
      {finals.teams.map((team) => (
        <TeamMatchup key={team.teamId} gameId={gameId} team={team} own={team.teamId === myTeamId} />
      ))}

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

/** A team's ballot card: its best recreation beside the original it chased. */
function TeamMatchup({ gameId, team, own }: { gameId: string; team: FinalsTeam; own: boolean }) {
  const original = useSignedPhoto(gameId, team.originalPhotoId ?? null);
  const recreation = useSignedPhoto(gameId, team.chasePhotoId ?? null);
  return (
    <Card>
      <Heading>{own ? `${team.name} (yours)` : team.name}</Heading>
      {team.chasePhotoId ? (
        <View style={styles.pair}>
          <Figure label="Original" uri={original.uri} failed={original.failed} testID={`finals-original-${team.teamId}`} />
          <Figure
            label="Best recreation"
            uri={recreation.uri}
            failed={recreation.failed}
            testID={`finals-chase-${team.teamId}`}
          />
        </View>
      ) : (
        <Body muted>No photos submitted.</Body>
      )}
    </Card>
  );
}

function Figure({
  label,
  uri,
  failed,
  testID,
}: {
  label: string;
  uri: string | null;
  failed: boolean;
  testID: string;
}) {
  return (
    <View style={styles.figure}>
      <Text style={styles.caption} numberOfLines={1}>
        {label}
      </Text>
      <View style={styles.frame}>
        {uri ? (
          <Image testID={testID} source={{ uri }} resizeMode="cover" style={StyleSheet.absoluteFill} />
        ) : (
          <Text style={styles.placeholder}>{failed ? 'Unavailable' : '…'}</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  /** Original beside recreation, so the match reads as the comparison it is. */
  pair: { flexDirection: 'row', gap: space.sm },
  figure: { flex: 1, gap: space.xs },
  frame: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: color.surfaceSunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  caption: { ...typeScale.label, color: color.inkMuted },
  placeholder: { ...typeScale.label, color: color.inkMuted },
});
