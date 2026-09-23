import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { createHmac, randomBytes } from 'crypto';
import { PrismaService } from '../prisma.service';
import { RedisService } from '../redis.service';
import { TokenService } from './token.service';

const MAX_ATTEMPTS = 5;
const LOCK_SECONDS = 900;
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

export function safeUser(user: any) {
  return { id: user.id, mobile: user.mobile, name: user.name, status: user.status, createdAt: user.createdAt };
}

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private redis: RedisService, private tokens: TokenService) {}

  private async checkLock(scope: string, key: string) {
    const ttl = await this.redis.client.ttl(`${scope}:lock:${key}`);
    if (ttl > 0) {
      throw new HttpException(
        `Too many failed attempts. Try again in ${Math.ceil(ttl / 60)} minute(s)`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async recordFailure(scope: string, key: string) {
    const failKey = `${scope}:fail:${key}`;
    const count = await this.redis.client.incr(failKey);
    await this.redis.client.expire(failKey, LOCK_SECONDS);
    if (count >= MAX_ATTEMPTS) {
      await this.redis.client.set(`${scope}:lock:${key}`, '1', 'EX', LOCK_SECONDS);
      await this.redis.client.del(failKey);
    }
  }

  private async clearFailures(scope: string, key: string) {
    await this.redis.client.del(`${scope}:fail:${key}`);
  }

  async register(dto: { mobile: string; password: string; name?: string }) {
    const existing = await this.prisma.user.findUnique({ where: { mobile: dto.mobile } });
    if (existing) throw new ConflictException('Mobile number is already registered');
    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
    const user = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.create({ data: { mobile: dto.mobile, name: dto.name || null, passwordHash } });
      await tx.moneyWallet.create({ data: { userId: u.id } });
      await tx.dollarWallet.create({ data: { userId: u.id } });
      return u;
    });
    return this.buildAuthResponse(user);
  }

  async login(dto: { mobile: string; password: string }) {
    await this.checkLock('cust', dto.mobile);
    const user = await this.prisma.user.findUnique({ where: { mobile: dto.mobile } });
    if (!user || !(await argon2.verify(user.passwordHash, dto.password).catch(() => false))) {
      await this.recordFailure('cust', dto.mobile);
      throw new UnauthorizedException('Invalid mobile number or password');
    }
    if (user.status !== 'ACTIVE') throw new HttpException('Account is blocked', HttpStatus.FORBIDDEN);
    await this.clearFailures('cust', dto.mobile);
    return this.buildAuthResponse(user);
  }

  private async buildAuthResponse(user: any) {
    const accessToken = this.tokens.signAccess(user.id, 'customer');
    const refreshToken = await this.tokens.issueRefresh('USER', user.id);
    return { user: safeUser(user), accessToken, refreshToken };
  }

  async refresh(raw: string) {
    const { ownerId, refreshToken } = await this.tokens.rotate(raw, 'USER');
    const user = await this.prisma.user.findUnique({ where: { id: ownerId } });
    if (!user || user.status !== 'ACTIVE') throw new UnauthorizedException('Account unavailable');
    return { user: safeUser(user), accessToken: this.tokens.signAccess(user.id, 'customer'), refreshToken };
  }

  async logout(raw: string) {
    await this.tokens.revoke(raw);
    return { message: 'Logged out' };
  }

  hashResetToken(raw: string): string {
    return createHmac('sha256', process.env.JWT_REFRESH_SECRET).update(`reset:${raw}`).digest('hex');
  }

  async createResetToken(userId: string, createdByAdminId?: string): Promise<string> {
    const raw = randomBytes(32).toString('hex');
    await this.prisma.passwordResetToken.create({
      data: {
        userId,
        tokenHash: this.hashResetToken(raw),
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
        createdByAdminId: createdByAdminId || null,
      },
    });
    return raw;
  }

  async forgotPassword(mobile: string) {
    const user = await this.prisma.user.findUnique({ where: { mobile } });
    if (user) {
      await this.createResetToken(user.id);
    }
    return {
      message:
        'If this mobile number is registered, a password reset has been initiated. Please contact support to complete the reset.',
    };
  }

  async resetPassword(token: string, newPassword: string) {
    const record = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash: this.hashResetToken(token) } });
    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired reset token');
    }
    const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: record.userId }, data: { passwordHash } });
      await tx.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
      await tx.refreshToken.updateMany({
        where: { ownerType: 'USER', ownerId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
    return { message: 'Password has been reset. Please log in with your new password.' };
  }
}
