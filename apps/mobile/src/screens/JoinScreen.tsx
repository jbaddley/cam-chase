import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

/** Enter a 6-character game code (or arrive here via a scanned QR deep link). */
export function JoinScreen({ onJoin }: { onJoin: (code: string) => void }) {
  const [code, setCode] = useState('');
  const ready = code.length === 6;
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Join a game</Text>
      <TextInput
        value={code}
        onChangeText={(t) => setCode(t.toUpperCase())}
        placeholder="ABC123"
        maxLength={6}
        autoCapitalize="characters"
        style={styles.input}
      />
      <Pressable onPress={() => ready && onJoin(code)} style={styles.button}>
        <Text>Join</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 16 },
  title: { fontSize: 28, fontWeight: '700' },
  input: { fontSize: 24, letterSpacing: 4, borderWidth: 1, padding: 12 },
  button: { backgroundColor: '#ffd43b', padding: 16, borderRadius: 12, alignItems: 'center' },
});
