import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../prisma.service';

export const PERMISSIONS_KEY = 'required_permissions';
export const RequirePermissions = (...perms: string[]) => SetMetadata(PERMISSIONS_KEY, perms);
export const SUPER_ADMIN_KEY = 'super_admin_only';
export const SuperAdminOnly = () => SetMetadata(SUPER_ADMIN_KEY, true);

function extractBearer(req: any): string | null {
  const header = req.headers?.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

function verifyAccess(token: string): any {
  try {
    return jwt.verify(token, process.env.JWT_ACCESS_SECRET);
  } catch {
    throw new UnauthorizedException('Invalid or expired token');
  }
}

@Injectable()
export class CustomerGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const token = extractBearer(req);
    if (!token) throw new UnauthorizedException('Not authenticated');
    const payload = verifyAccess(token);
    if (payload.kind !== 'customer') throw new UnauthorizedException('Invalid token type');
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw new UnauthorizedException('User not found');
    if (user.status !== 'ACTIVE') throw new ForbiddenException('Account is blocked');
    req.user = user;
    return true;
  }
}

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const token = extractBearer(req);
    if (!token) throw new UnauthorizedException('Not authenticated');
    const payload = verifyAccess(token);
    if (payload.kind !== 'admin') throw new ForbiddenException('Admin access required');
    const admin = await this.prisma.admin.findUnique({ where: { id: payload.sub } });
    if (!admin || !admin.isActive) throw new UnauthorizedException('Admin account not found or disabled');
    req.admin = admin;
    return true;
  }
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const admin = req.admin;
    if (!admin) throw new ForbiddenException('Admin access required');
    const superOnly = this.reflector.getAllAndOverride<boolean>(SUPER_ADMIN_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (superOnly && admin.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Super Admin access required');
    }
    const perms = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (perms && perms.length && admin.role !== 'SUPER_ADMIN') {
      const missing = perms.filter((p) => !(admin.permissions || []).includes(p));
      if (missing.length) throw new ForbiddenException(`Missing permission: ${missing.join(', ')}`);
    }
    return true;
  }
}
