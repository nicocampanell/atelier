import { describe, expect, it } from 'vitest';
import { fieldScale, scaledFieldProps } from './surfaceBridge';

describe('Surface Field zoom scaling', () => {
  it('clamps and quantizes the scale', () => {
    expect(fieldScale(0.1)).toBe(0.5);
    expect(fieldScale(3)).toBe(2.5);
    expect(fieldScale(1)).toBe(1);
    expect(fieldScale(1.13)).toBe(1.15);
  });

  it('scales effect widths with zoom while leaving grid spacing to the viewport', () => {
    expect(scaledFieldProps(2)).toMatchObject({ gap: 21, focusRadius: 440, lineRadius: 340, rippleWidth: 76 });
    expect(scaledFieldProps(0.5)).toMatchObject({ gap: 21, focusRadius: 110, lineRadius: 85, rippleWidth: 19 });
  });

  it('preserves the original settings at scale 1', () => {
    expect(scaledFieldProps(1)).toMatchObject({
      gap: 21, focusRadius: 220, lineRadius: 170, cursorPush: 2,
      ripplePush: 4, cursorPushRadius: 110, rippleWidth: 38,
      rippleBoost: 0.07, rippleGrow: 0.15, rippleSpeed: 1.1,
      baseOpacity: 0.02, maxOpacity: 0.19, breathe: 0, wander: false,
    });
  });
});
