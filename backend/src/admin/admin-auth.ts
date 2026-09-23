import { Body, Controller, Get, HttpCode, HttpException, HttpStatus, Injectable, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma.service';
import { RedisService } from '../redis.service';
import { TokenService } from '../auth/token.service';
import { AdminGuard } from '../common/guards';
import { AdminLoginDto, RefreshDto } from '../common/dto';

export function safeAdmin(a: any) {
  return { id: a.id, email: a.email, name: a.name, role: a.role, permissions: a.permissions, isActive: a.isActive, createdAt: a.createdAt };
}

@Injectable()
export class AdminAuthService {
  constructor(private prisma: PrismaService, private redis: RedisService, private tokens: TokenService) {}

  async login(dto: { email: string; password: string }) {
    const email = dto.email.toLowerCase().trim();
    const ttl = await this.redis.client.ttl(`adm:lock:${email}`);
    if (ttl > 0) {
      throw new HttpException(`Too many failed attempts. Try again in ${Math.ceil(ttl / 60)} minute(s)`, HttpStatus.TOO_MANY_REQUESTS);
    }
    const admin = await this.prisma.admin.findUnique({ where: { email } });
    if (!admin || !(await argon2.verify(admin.passwordHash, dto.password).catch(() => false))) {
      const count = await this.redis.client.incr(`adm:fail:${email}`);
      await this.redis.client.expire(`adm:fail:${email}`, 900);
      if (count >= 5) {
        await this.redis.client.set(`adm:lock:${email}`, '1', 'EX', 900);
        await this.redis.client.del(`adm:fail:${email}`);
      }
      throw new UnauthorizedException('Invalid email or password');
    }
    if (!admin.isActive) throw new HttpException('Admin account is disabled', HttpStatus.FORBIDDEN);
    await this.redis.client.del(`adm:fail:${email}`);
    const refreshToken = await this.tokens.issueRefresh('ADMIN', admin.id);
    return { admin: safeAdmin(admin), accessToken: this.tokens.signAccess(admin.id, 'admin'), refreshToken };
  }

  async refresh(raw: string) {
    const { ownerId, refreshToken } = await this.tokens.rotate(raw, 'ADMIN');
    const admin = await this.prisma.admin.findUnique({ where: { id: ownerId } });
    if (!admin || !admin.isActive) throw new UnauthorizedException('Admin account unavailable');
    return { admin: safeAdmin(admin), accessToken: this.tokens.signAccess(admin.id, 'admin'), refreshToken };
  }

  async logout(raw: string) {
    await this.tokens.revoke(raw);
    return { message: 'Logged out' };
  }
}

@Controller('admin/auth')
export class AdminAuthController {
  constructor(private auth: AdminAuthService) {}

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(200)
  @Post('login')
  login(@Body() dto: AdminLoginDto) {
    return this.auth.login(dto);
  }

  @HttpCode(200)
  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @UseGuards(AdminGuard)
  @HttpCode(200)
  @Post('logout')
  logout(@Body() dto: RefreshDto) {
    return this.auth.logout(dto.refreshToken);
  }

  @UseGuards(AdminGuard)
  @Get('me')
  me(@Req() req: any) {
    return safeAdmin(req.admin);
  }
}
