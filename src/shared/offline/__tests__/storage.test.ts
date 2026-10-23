import { describe, expect, it } from 'vitest';

import { photoBudgetBytes } from '../storage';

describe('photoBudgetBytes', () => {
  it('undefined device memory takes the conservative branch by design', () => {
    expect(photoBudgetBytes({ cores: 8, memoryGb: undefined, saveData: false })).toBe(600_000);
  });
  it('saveData always wins', () => {
    expect(photoBudgetBytes({ cores: 8, memoryGb: 8, saveData: true })).toBe(600_000);
  });
  it('a capable phone gets the larger budget', () => {
    expect(photoBudgetBytes({ cores: 8, memoryGb: 4, saveData: false })).toBe(1_500_000);
  });
  it('two gigabytes is low-end', () => {
    expect(photoBudgetBytes({ cores: 4, memoryGb: 2, saveData: false })).toBe(600_000);
  });
});
