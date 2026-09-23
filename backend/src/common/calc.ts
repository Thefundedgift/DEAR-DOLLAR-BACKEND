import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export function dec(v: any): Prisma.Decimal {
  return new Prisma.Decimal(String(v));
}

export interface OrderCalc {
  units: Prisma.Decimal;
  moneyAmount: Prisma.Decimal;
  rate: Prisma.Decimal;
}

export function computeOrder(points: any, moneyValue: any, pointQuantity: any): OrderCalc {
  const p = dec(points);
  const mv = dec(moneyValue);
  const pq = dec(pointQuantity);
  if (!p.isFinite() || p.lte(0)) throw new BadRequestException('Points must be greater than zero');
  if (pq.lte(0) || mv.lte(0)) throw new BadRequestException('Invalid listing rate configuration');
  const units = p.div(pq);
  if (!units.isInteger()) throw new BadRequestException(`Points must be a multiple of ${pq.toString()}`);
  const moneyAmount = units.mul(mv).toDecimalPlaces(2);
  const rate = mv.div(pq).toDecimalPlaces(6);
  return { units, moneyAmount, rate };
}

export function maskAccountNumber(acc: string): string {
  if (!acc || acc.length <= 4) return acc;
  return '*'.repeat(acc.length - 4) + acc.slice(-4);
}
