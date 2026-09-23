import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { CustomerGuard } from '../common/guards';
import { PrismaService } from '../prisma.service';

function listingView(l: any) {
  return {
    id: l.id,
    title: l.title,
    description: l.description,
    moneyValue: l.moneyValue,
    pointQuantity: l.pointQuantity,
    availableQuantity: l.availableQuantity,
    remainingQuantity: l.remainingQuantity,
    startDate: l.startDate,
    endDate: l.endDate,
    status: l.status,
  };
}

@Controller('points')
@UseGuards(CustomerGuard)
export class PointsController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async wallet(@Req() req: any) {
    const w = await this.prisma.dollarWallet.findUnique({ where: { userId: req.user.id } });
    return { availablePoints: w.availablePoints, pendingPoints: w.pendingPoints, unit: '$DOLLAR' };
  }

  @Get('transactions')
  async transactions(@Req() req: any, @Query('page') page = '1') {
    const w = await this.prisma.dollarWallet.findUnique({ where: { userId: req.user.id } });
    const take = 50;
    const skip = (Math.max(parseInt(page, 10) || 1, 1) - 1) * take;
    const [items, total] = await Promise.all([
      this.prisma.dollarWalletTransaction.findMany({ where: { walletId: w.id }, orderBy: { createdAt: 'desc' }, take, skip }),
      this.prisma.dollarWalletTransaction.count({ where: { walletId: w.id } }),
    ]);
    return { items, total };
  }

  @Get('buy-listings')
  async buyListings() {
    const now = new Date();
    const items = await this.prisma.buyListing.findMany({
      where: { status: 'ACTIVE', startDate: { lte: now }, endDate: { gte: now }, remainingQuantity: { gt: 0 } },
      orderBy: { createdAt: 'desc' },
    });
    return items.map(listingView);
  }

  @Get('demand-listings')
  async demandListings() {
    const now = new Date();
    const items = await this.prisma.demandListing.findMany({
      where: { status: 'ACTIVE', startDate: { lte: now }, endDate: { gte: now }, remainingQuantity: { gt: 0 } },
      orderBy: { createdAt: 'desc' },
    });
    return items.map(listingView);
  }
}
