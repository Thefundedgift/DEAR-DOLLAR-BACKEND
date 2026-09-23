import { computeOrder, dec, maskAccountNumber } from '../src/common/calc';
import { BadRequestException } from '@nestjs/common';

describe('Order calculations (server-side, never trust frontend)', () => {
  it('buy example: 360 $DOLLAR at ₹40 = 9 $DOLLAR → ₹1600', () => {
    const calc = computeOrder(360, 40, 9);
    expect(calc.units.toString()).toBe('40');
    expect(calc.moneyAmount.toString()).toBe('1600');
  });

  it('sell example: 200 $DOLLAR at ₹20 = 10 $DOLLAR → ₹400', () => {
    const calc = computeOrder(200, 20, 10);
    expect(calc.units.toString()).toBe('20');
    expect(calc.moneyAmount.toString()).toBe('400');
  });

  it('simple rate: ₹100 = 1 $DOLLAR → 5 points = ₹500', () => {
    const calc = computeOrder(5, 100, 1);
    expect(calc.moneyAmount.toString()).toBe('500');
    expect(calc.rate.toString()).toBe('100');
  });

  it('stores rate snapshot (money per point)', () => {
    const calc = computeOrder(360, 40, 9);
    expect(calc.rate.toFixed(4)).toBe('4.4444');
  });

  it('rejects points that are not a multiple of listing pointQuantity', () => {
    expect(() => computeOrder(361, 40, 9)).toThrow(BadRequestException);
    expect(() => computeOrder(5, 20, 10)).toThrow(BadRequestException);
  });

  it('rejects zero and negative points', () => {
    expect(() => computeOrder(0, 40, 9)).toThrow(BadRequestException);
    expect(() => computeOrder(-9, 40, 9)).toThrow(BadRequestException);
  });

  it('rejects invalid listing rate config', () => {
    expect(() => computeOrder(10, 0, 1)).toThrow(BadRequestException);
    expect(() => computeOrder(10, 100, 0)).toThrow(BadRequestException);
  });

  it('rate change on listing does NOT affect a previously computed snapshot', () => {
    const before = computeOrder(360, 40, 9);
    const after = computeOrder(360, 80, 9); // admin doubled the rate
    expect(before.moneyAmount.toString()).toBe('1600');
    expect(after.moneyAmount.toString()).toBe('3200');
    // snapshot from `before` is unchanged
    expect(before.rate.toFixed(4)).toBe('4.4444');
  });

  it('decimal precision is exact (no float drift)', () => {
    const calc = computeOrder(dec('0.03'), dec('0.01'), dec('0.01'));
    expect(calc.moneyAmount.toString()).toBe('0.03');
  });
});

describe('Sensitive data masking', () => {
  it('masks bank account numbers to last 4 digits', () => {
    expect(maskAccountNumber('123456789012')).toBe('********9012');
  });
});
