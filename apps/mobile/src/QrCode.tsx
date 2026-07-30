import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import QRCode from 'qrcode';

/**
 * A QR code, drawn with plain Views — no SVG, no native module, no prebuild.
 *
 * `react-native-svg` is not in the app and would pull one in; the `qrcode`
 * package generates the module matrix in pure JS (no canvas), and each row is
 * painted as runs of dark cells so a 29×29 code is a few dozen Views rather than
 * hundreds. Styles are dropped under the jsdom test harness, so the matrix's
 * correctness is the `qrcode` package's to guarantee — the tests only check the
 * code renders.
 */

/** The `qrcode` module matrix as rows of dark/light booleans. */
export function qrMatrix(value: string): boolean[][] {
  const qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
  const { size, data } = qr.modules;
  const rows: boolean[][] = [];
  for (let y = 0; y < size; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < size; x++) row.push(data[y * size + x] === 1);
    rows.push(row);
  }
  return rows;
}

/** Collapse a row into runs of same-colour cells, so each run is one View. */
function runs(row: readonly boolean[]): Array<{ dark: boolean; len: number }> {
  const out: Array<{ dark: boolean; len: number }> = [];
  for (const dark of row) {
    const last = out[out.length - 1];
    if (last && last.dark === dark) last.len += 1;
    else out.push({ dark, len: 1 });
  }
  return out;
}

export function QrCode({ value, size = 220, testID }: { value: string; size?: number; testID?: string }) {
  const matrix = useMemo(() => qrMatrix(value), [value]);
  const modules = matrix.length || 1;
  // A whole-pixel cell keeps rows aligned; a fractional one leaves seams.
  const cell = Math.max(1, Math.floor(size / modules));
  const quiet = cell * 2; // the light border a scanner needs to find the code

  return (
    <View style={[styles.frame, { padding: quiet }]} testID={testID}>
      {matrix.map((row, y) => (
        <View key={y} style={{ flexDirection: 'row', height: cell }}>
          {runs(row).map((run, i) => (
            <View
              key={i}
              style={{ width: run.len * cell, height: cell, backgroundColor: run.dark ? '#000' : 'transparent' }}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { backgroundColor: '#fff', alignSelf: 'center' },
});
