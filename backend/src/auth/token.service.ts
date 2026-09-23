import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { createHmac, randomBytes } from 'crypto';
import { PrismaService } from '../prisma.service';

const REFRESH_TTL_DAYS = 7;

@Injectable()
export class TokenService {
  constructor(private prisma: PrismaService) {}

  signAccess(sub: string, kind: 'customer' | 'admin'): string {
    return jwt.sign({ sub, kind }, process.env.JWT_ACCESS_SECRET, { expiresIn: '15m' });
  }

  hashRefresh(raw: string): string {
    return createHmac('sha256', process.env.JWT_REFRESH_SECRET).update(raw).digest('hex');
  }

  async issueRefresh(ownerType: 'USER' | 'ADMIN', ownerId: string): Promise<string> {
    const raw = randomBytes(48).toString('hex');
    await this.prisma.refreshToken.create({
      data: {
        tokenHash: this.hashRefresh(raw),
        ownerType,
        ownerId,
        expiresAt: new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 3600 * 1000),
      },
    });
    return raw;
  }

  async rotate(raw: string, expectedOwnerType: 'USER' | 'ADMIN') {
    const record = await this.prisma.refreshToken.findUnique({ where: { tokenHash: this.hashRefresh(raw) } });
    if (!record || record.ownerType !== expectedOwnerType) throw new UnauthorizedException('Invalid refresh token');
    if (record.revokedAt) {
      await this.revokeAll(record.ownerType as any, record.ownerId);
      throw new UnauthorizedException('Refresh token reuse detected. All sessions revoked.');
    }
    if (record.expiresAt < new Date()) throw new UnauthorizedException('Refresh token expired');
    await this.prisma.refreshToken.update({ where: { id: record.id }, data: { revokedAt: new Date() } });
    const newRaw = await this.issueRefresh(record.ownerType as any, record.ownerId);
    return { ownerId: record.ownerId, refreshToken: newRaw };
  }

  async revoke(raw: string) {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.hashRefresh(raw), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAll(ownerType: 'USER' | 'ADMIN', ownerId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { ownerType, ownerId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
