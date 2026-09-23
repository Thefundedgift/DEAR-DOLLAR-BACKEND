import { Body, Controller, Get, Param, Put, Req, UseGuards } from '@nestjs/common';
import { AdminGuard, PermissionsGuard, SuperAdminOnly } from './common/guards';
import { SocialLinkDto } from './common/dto';
import { PrismaService } from './prisma.service';
import { AuditService } from './audit.service';
import { getClientIp } from './common/constants';
import { BadRequestException } from '@nestjs/common';

const PLATFORMS = ['TELEGRAM', 'DISCORD'];

@Controller('social-links')
export class SocialLinksController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async enabledLinks() {
    const links = await this.prisma.socialLink.findMany({ where: { enabled: true } });
    return links.map((l) => ({ platform: l.platform, url: l.url }));
  }
}

@Controller('admin/social-links')
@UseGuards(AdminGuard, PermissionsGuard)
@SuperAdminOnly()
export class AdminSocialLinksController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  @Get()
  list() {
    return this.prisma.socialLink.findMany({ orderBy: { platform: 'asc' } });
  }

  @Put(':platform')
  async upsert(@Req() req: any, @Param('platform') platform: string, @Body() dto: SocialLinkDto) {
    const p = platform.toUpperCase();
    if (!PLATFORMS.includes(p)) throw new BadRequestException(`Platform must be one of: ${PLATFORMS.join(', ')}`);
    const link = await this.prisma.socialLink.upsert({
      where: { platform: p as any },
      create: { platform: p as any, url: dto.url, enabled: dto.enabled, updatedById: req.admin.id },
      update: { url: dto.url, enabled: dto.enabled, updatedById: req.admin.id },
    });
    await this.audit.log({
      adminId: req.admin.id,
      action: 'SOCIAL_LINK_UPDATED',
      entityType: 'SocialLink',
      entityId: link.id,
      details: { platform: p, url: dto.url, enabled: dto.enabled },
      ip: getClientIp(req),
    });
    return link;
  }
}
