import { ScrollView, StyleSheet, Text, View } from 'react-native';

export interface LobbyTeam {
  teamId: string;
  name: string;
  memberCount: number;
}

/** Live roster of teams that have joined; needs ≥2 teams to start. */
export function LobbyScreen({ code, teams }: { code: string; teams: LobbyTeam[] }) {
  return (
    <View style={styles.container}>
      <Text style={styles.code}>Code: {code}</Text>
      <Text style={styles.subtitle}>
        {teams.length} team{teams.length === 1 ? '' : 's'} joined
      </Text>
      <ScrollView>
        {teams.map((t) => (
          <View key={t.teamId} style={styles.row}>
            <Text style={styles.teamName}>{t.name}</Text>
            <Text>
              {t.memberCount} player{t.memberCount === 1 ? '' : 's'}
            </Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 8 },
  code: { fontSize: 24, fontWeight: '700' },
  subtitle: { color: '#666' },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12 },
  teamName: { fontSize: 18 },
});
