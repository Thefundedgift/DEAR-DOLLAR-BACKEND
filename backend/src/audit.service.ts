import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async log(params: {
    adminId?: string;
    action: string;
    entityType?: string;
    entityId?: string;
    details?: any;
    ip?: string;
  }) {
    await this.prisma.auditLog
      .create({
        data: {
          adminId: params.adminId || null,
          action: params.action,
          entityType: params.entityType || null,
          entityId: params.entityId || null,
          details: params.details ?? undefined,
          ipAddress: params.ip || null,
        },
      })
      .catch(() => undefined);
  }
}
