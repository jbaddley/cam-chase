import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { QrCode, qrMatrix } from './QrCode.js';

afterEach(cleanup);

describe('qrMatrix', () => {
  it('produces a square matrix of modules for a value', () => {
    const matrix = qrMatrix('https://photochase.app/j/ABC234');
    expect(matrix.length).toBeGreaterThan(0);
    // Square, and made of booleans (the module colours).
    expect(matrix.every((row) => row.length === matrix.length)).toBe(true);
    expect(matrix.some((row) => row.some((cell) => cell))).toBe(true);
  });

  it('is deterministic for the same value', () => {
    expect(qrMatrix('ABC234')).toEqual(qrMatrix('ABC234'));
  });
});

describe('QrCode', () => {
  it('renders a code with its rows (styles are dropped under jsdom)', () => {
    render(<QrCode value="https://photochase.app/j/ABC234" testID="qr" />);
    const el = screen.getByTestId('qr');
    expect(el).toBeTruthy();
    // One child View per module row; the matrix has many.
    expect(el.children.length).toBeGreaterThan(10);
  });
});
