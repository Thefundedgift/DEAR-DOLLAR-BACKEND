import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';

@Controller('health')
export class HealthController {
  constructor(private prisma: PrismaService, private redis: RedisService) {}

  @Get()
  async health() {
    let database = 'connected';
    let redis = 'connected';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'disconnected';
    }
    try {
      const pong = await this.redis.client.ping();
      if (pong !== 'PONG') redis = 'disconnected';
    } catch {
      redis = 'disconnected';
    }
    const body = { status: database === 'connected' && redis === 'connected' ? 'ok' : 'degraded', database, redis };
    if (body.status !== 'ok') throw new ServiceUnavailableException(body);
    return body;
  }
}
