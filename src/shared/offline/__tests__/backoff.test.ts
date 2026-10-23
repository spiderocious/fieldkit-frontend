import { describe, expect, it } from 'vitest';

import { nextDelayMs } from '../backoff';

describe('nextDelayMs', () => {
  it('doubles per attempt and caps', () => {
    const noJitter = { random: () => 1 }; // factor 1.0
    expect(nextDelayMs(0, noJitter)).toBe(1000);
    expect(nextDelayMs(1, noJitter)).toBe(2000);
    expect(nextDelayMs(3, noJitter)).toBe(8000);
    expect(nextDelayMs(10, noJitter)).toBe(60_000);
  });

  it('jitter lands in [0.5x, 1x]', () => {
    expect(nextDelayMs(2, { random: () => 0 })).toBe(2000);
    expect(nextDelayMs(2, { random: () => 0.999 })).toBeLessThanOrEqual(4000);
    expect(nextDelayMs(2, { random: () => 0.999 })).toBeGreaterThan(3990);
  });

  it('fifty clients do not retry at the same instant', () => {
    const delays = new Set<number>();
    for (let i = 0; i < 50; i++) delays.add(nextDelayMs(3));
    expect(delays.size).toBeGreaterThan(20);
  });
});
