import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { computeOrder, dec } from '../common/calc';

@Injectable()
export class OrdersService {
  constructor(private prisma: PrismaService, private wallet: WalletService) {}

  async createBuyOrder(userId: string, listingId: string, points: number, idempotencyKey?: string) {
    if (idempotencyKey) {
      const existing = await this.prisma.buyOrder.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } } });
      if (existing) return existing;
    }
    const pointsDec = dec(points);
    return this.prisma.$transaction(async (tx) => {
      const listing = await tx.buyListing.findUnique({ where: { id: listingId } });
      this.validateListing(listing);
      const calc = computeOrder(pointsDec, listing.moneyValue, listing.pointQuantity);
      const reserved = await tx.$executeRaw`UPDATE buy_listings SET remaining_quantity = remaining_quantity - ${pointsDec.toString()}::numeric, updated_at = now() WHERE id = ${listing.id} AND remaining_quantity >= ${pointsDec.toString()}::numeric AND status::text = 'ACTIVE'`;
      if (!reserved) throw new BadRequestException('Not enough quantity remaining in this listing');
      const orderId = randomUUID();
      await this.wallet.debitMoney(tx, userId, calc.moneyAmount, 'POINT_PURCHASE', orderId, 'PENDING', `Buy ${pointsDec.toString()} $DOLLAR`);
      return tx.buyOrder.create({
        data: {
          id: orderId,
          userId,
          listingId: listing.id,
          points: pointsDec,
          listingMoneyValue: listing.moneyValue,
          listingPointQuantity: listing.pointQuantity,
          rate: calc.rate,
          moneyAmount: calc.moneyAmount,
          idempotencyKey: idempotencyKey || null,
        },
      });
    }, { timeout: 15000 });
  }

  async createSellOrder(userId: string, listingId: string, points: number, idempotencyKey?: string) {
    if (idempotencyKey) {
      const existing = await this.prisma.sellOrder.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } } });
      if (existing) return existing;
    }
    const pointsDec = dec(points);
    return this.prisma.$transaction(async (tx) => {
      const listing = await tx.demandListing.findUnique({ where: { id: listingId } });
      this.validateListing(listing);
      const calc = computeOrder(pointsDec, listing.moneyValue, listing.pointQuantity);
      const reserved = await tx.$executeRaw`UPDATE demand_listings SET remaining_quantity = remaining_quantity - ${pointsDec.toString()}::numeric, updated_at = now() WHERE id = ${listing.id} AND remaining_quantity >= ${pointsDec.toString()}::numeric AND status::text = 'ACTIVE'`;
      if (!reserved) throw new BadRequestException('Not enough quantity remaining in this demand listing');
      const orderId = randomUUID();
      await this.wallet.debitPoints(tx, userId, pointsDec, 'DOLLAR_SELL', calc.rate, calc.moneyAmount, orderId, 'PENDING', `Sell ${pointsDec.toString()} $DOLLAR`);
      return tx.sellOrder.create({
        data: {
          id: orderId,
          userId,
          listingId: listing.id,
          points: pointsDec,
          listingMoneyValue: listing.moneyValue,
          listingPointQuantity: listing.pointQuantity,
          rate: calc.rate,
          moneyAmount: calc.moneyAmount,
          idempotencyKey: idempotencyKey || null,
        },
      });
    }, { timeout: 15000 });
  }

  private validateListing(listing: any) {
    if (!listing) throw new NotFoundException('Listing not found');
    const now = new Date();
    if (listing.status !== 'ACTIVE') throw new BadRequestException('Listing is not active');
    if (listing.startDate > now) throw new BadRequestException('Listing has not started yet');
    if (listing.endDate < now) throw new BadRequestException('Listing has expired');
  }

  listBuyOrders(userId: string) {
    return this.prisma.buyOrder.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 100 });
  }

  listSellOrders(userId: string) {
    return this.prisma.sellOrder.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 100 });
  }

  async approveBuyOrder(adminId: string, orderId: string) {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.buyOrder.updateMany({
        where: { id: orderId, status: 'PENDING' },
        data: { status: 'APPROVED', approvedById: adminId, approvedAt: new Date() },
      });
      if (!claimed.count) throw new ConflictException('Order is not pending (already processed?)');
      const order = await tx.buyOrder.findUnique({ where: { id: orderId } });
      await this.wallet.creditPoints(tx, order.userId, order.points, 'DOLLAR_PURCHASE', order.rate, order.moneyAmount, order.id, 'COMPLETED', 'Buy order approved');
      await tx.moneyWalletTransaction.updateMany({ where: { reference: order.id, status: 'PENDING' }, data: { status: 'COMPLETED' } });
      return tx.buyOrder.update({ where: { id: orderId }, data: { status: 'COMPLETED' } });
    }, { timeout: 15000 });
  }

  async rejectBuyOrder(adminId: string, orderId: string, reason?: string) {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.buyOrder.updateMany({
        where: { id: orderId, status: 'PENDING' },
        data: { status: 'REJECTED', approvedById: adminId, approvedAt: new Date(), rejectedReason: reason || null },
      });
      if (!claimed.count) throw new ConflictException('Order is not pending (already processed?)');
      const order = await tx.buyOrder.findUnique({ where: { id: orderId } });
      await tx.moneyWalletTransaction.updateMany({ where: { reference: order.id, status: 'PENDING' }, data: { status: 'REVERSED' } });
      await this.wallet.creditMoney(tx, order.userId, order.moneyAmount, 'REFUND', order.id, 'COMPLETED', 'Buy order rejected - refund');
      await tx.$executeRaw`UPDATE buy_listings SET remaining_quantity = remaining_quantity + ${order.points.toString()}::numeric, updated_at = now() WHERE id = ${order.listingId}`;
      return tx.buyOrder.findUnique({ where: { id: orderId } });
    }, { timeout: 15000 });
  }

  async approveSellOrder(adminId: string, orderId: string) {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.sellOrder.updateMany({
        where: { id: orderId, status: 'PENDING' },
        data: { status: 'APPROVED', approvedById: adminId, approvedAt: new Date() },
      });
      if (!claimed.count) throw new ConflictException('Order is not pending (already processed?)');
      const order = await tx.sellOrder.findUnique({ where: { id: orderId } });
      await this.wallet.creditMoney(tx, order.userId, order.moneyAmount, 'POINT_SELL', order.id, 'COMPLETED', 'Sell order approved');
      await tx.dollarWalletTransaction.updateMany({ where: { referenceId: order.id, status: 'PENDING' }, data: { status: 'COMPLETED' } });
      return tx.sellOrder.update({ where: { id: orderId }, data: { status: 'COMPLETED' } });
    }, { timeout: 15000 });
  }

  async rejectSellOrder(adminId: string, orderId: string, reason?: string) {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.sellOrder.updateMany({
        where: { id: orderId, status: 'PENDING' },
        data: { status: 'REJECTED', approvedById: adminId, approvedAt: new Date(), rejectedReason: reason || null },
      });
      if (!claimed.count) throw new ConflictException('Order is not pending (already processed?)');
      const order = await tx.sellOrder.findUnique({ where: { id: orderId } });
      await tx.dollarWalletTransaction.updateMany({ where: { referenceId: order.id, status: 'PENDING' }, data: { status: 'REVERSED' } });
      await this.wallet.creditPoints(tx, order.userId, order.points, 'REFUND', order.rate, order.moneyAmount, order.id, 'COMPLETED', 'Sell order rejected - points returned');
      await tx.$executeRaw`UPDATE demand_listings SET remaining_quantity = remaining_quantity + ${order.points.toString()}::numeric, updated_at = now() WHERE id = ${order.listingId}`;
      return tx.sellOrder.findUnique({ where: { id: orderId } });
    }, { timeout: 15000 });
  }
}
