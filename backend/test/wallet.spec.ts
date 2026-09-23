import 'dotenv/config';
import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../src/prisma.service';
import { WalletService } from '../src/wallet/wallet.service';
import { OrdersService } from '../src/orders/orders.service';
import { dec } from '../src/common/calc';

// Integration tests - require DATABASE_URL (PostgreSQL) to be reachable
describe('Wallet + order flows (PostgreSQL transactions)', () => {
  let prisma: PrismaService;
  let wallet: WalletService;
  let orders: OrdersService;
  let userId: string;
  let adminId: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    wallet = new WalletService(prisma);
    orders = new OrdersService(prisma, wallet);
    const user = await prisma.user.create({
      data: { mobile: `9${Date.now().toString().slice(-9)}`, passwordHash: 'x', name: 'Test User' },
    });
    userId = user.id;
    await prisma.moneyWallet.create({ data: { userId } });
    await prisma.dollarWallet.create({ data: { userId } });
    const admin = await prisma.admin.create({
      data: { email: `t${Date.now()}@test.local`, name: 'T', passwordHash: 'x', role: 'SUPER_ADMIN' },
    });
    adminId = admin.id;
  });

  afterAll(async () => {
    await prisma.buyOrder.deleteMany({ where: { userId } });
    await prisma.sellOrder.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    await prisma.admin.delete({ where: { id: adminId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('credits the money wallet', async () => {
    const tx = await prisma.$transaction(async (t) => wallet.creditMoney(t, userId, dec(10000), 'ADJUSTMENT', 'test-credit'));
    expect(tx.balanceAfter.toString()).toBe('10000');
  });

  it('debits the money wallet', async () => {
    const tx = await prisma.$transaction(async (t) => wallet.debitMoney(t, userId, dec(1600), 'ADJUSTMENT', 'test-debit'));
    expect(tx.balanceAfter.toString()).toBe('8400');
  });

  it('rejects debit with insufficient balance', async () => {
    await expect(
      prisma.$transaction(async (t) => wallet.debitMoney(t, userId, dec(999999), 'ADJUSTMENT', 'too-much')),
    ).rejects.toThrow(BadRequestException);
  });

  it('credits and debits $DOLLAR points', async () => {
    const credit = await prisma.$transaction(async (t) =>
      wallet.creditPoints(t, userId, dec(360), 'DOLLAR_PURCHASE', dec('4.444444'), dec(1600), 'test-ref'),
    );
    expect(credit.balanceAfter.toString()).toBe('360');
    const debit = await prisma.$transaction(async (t) =>
      wallet.debitPoints(t, userId, dec(100), 'DOLLAR_SELL', dec('2'), dec(200), 'test-ref-2'),
    );
    expect(debit.balanceAfter.toString()).toBe('260');
  });

  it('rejects points debit with insufficient points', async () => {
    await expect(
      prisma.$transaction(async (t) => wallet.debitPoints(t, userId, dec(99999), 'DOLLAR_SELL', dec('1'), dec(1), 'x')),
    ).rejects.toThrow(BadRequestException);
  });

  it('allows only one of two concurrent debits when funds cover just one', async () => {
    const w = await prisma.moneyWallet.findUnique({ where: { userId } });
    const balance = w.availableBalance; // 8400
    const big = balance.mul(dec('0.75')).toDecimalPlaces(2);
    const results = await Promise.allSettled([
      prisma.$transaction(async (t) => wallet.debitMoney(t, userId, big, 'ADJUSTMENT', 'race-1')),
      prisma.$transaction(async (t) => wallet.debitMoney(t, userId, big, 'ADJUSTMENT', 'race-2')),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    expect(ok).toBe(1);
    const after = await prisma.moneyWallet.findUnique({ where: { userId } });
    expect(after.availableBalance.gte(0)).toBe(true);
    // restore
    await prisma.$transaction(async (t) => wallet.creditMoney(t, userId, big, 'ADJUSTMENT', 'race-restore'));
  });

  it('full buy flow: order, duplicate approval blocked, rate snapshot survives rate change', async () => {
    const listing = await prisma.buyListing.create({
      data: {
        title: 'Test Buy',
        moneyValue: dec(40),
        pointQuantity: dec(9),
        availableQuantity: dec(720),
        remainingQuantity: dec(720),
        startDate: new Date(Date.now() - 3600000),
        endDate: new Date(Date.now() + 3600000),
        createdById: adminId,
      },
    });
    const before = await prisma.moneyWallet.findUnique({ where: { userId } });
    const order = await orders.createBuyOrder(userId, listing.id, 360);
    expect(order.moneyAmount.toString()).toBe('1600');
    const afterOrder = await prisma.moneyWallet.findUnique({ where: { userId } });
    expect(before.availableBalance.sub(afterOrder.availableBalance).toString()).toBe('1600');

    // admin changes the rate AFTER order creation
    await prisma.buyListing.update({ where: { id: listing.id }, data: { moneyValue: dec(80) } });

    const approved = await orders.approveBuyOrder(adminId, order.id);
    expect(approved.status).toBe('COMPLETED');
    expect(approved.moneyAmount.toString()).toBe('1600'); // snapshot unchanged

    // duplicate approval must fail
    await expect(orders.approveBuyOrder(adminId, order.id)).rejects.toThrow();

    const dw = await prisma.dollarWallet.findUnique({ where: { userId } });
    expect(dw.availablePoints.gte(dec(360))).toBe(true);

    // overselling prevention
    await expect(orders.createBuyOrder(userId, listing.id, 720)).rejects.toThrow(BadRequestException);
    await prisma.buyListing.delete({ where: { id: listing.id } }).catch(() => undefined);
  });

  it('sell flow: rejection refunds points', async () => {
    const listing = await prisma.demandListing.create({
      data: {
        title: 'Test Demand',
        moneyValue: dec(20),
        pointQuantity: dec(10),
        availableQuantity: dec(1000),
        remainingQuantity: dec(1000),
        startDate: new Date(Date.now() - 3600000),
        endDate: new Date(Date.now() + 3600000),
        createdById: adminId,
      },
    });
    const before = await prisma.dollarWallet.findUnique({ where: { userId } });
    const order = await orders.createSellOrder(userId, listing.id, 200);
    expect(order.moneyAmount.toString()).toBe('400');
    const rejected = await orders.rejectSellOrder(adminId, order.id, 'test rejection');
    expect(rejected.status).toBe('REJECTED');
    const after = await prisma.dollarWallet.findUnique({ where: { userId } });
    expect(after.availablePoints.toString()).toBe(before.availablePoints.toString());
    const restored = await prisma.demandListing.findUnique({ where: { id: listing.id } });
    expect(restored.remainingQuantity.toString()).toBe('1000');
    await prisma.demandListing.delete({ where: { id: listing.id } }).catch(() => undefined);
  });

  it('idempotency: same key returns the same order', async () => {
    const listing = await prisma.buyListing.create({
      data: {
        title: 'Idem',
        moneyValue: dec(10),
        pointQuantity: dec(1),
        availableQuantity: dec(100),
        remainingQuantity: dec(100),
        startDate: new Date(Date.now() - 3600000),
        endDate: new Date(Date.now() + 3600000),
        createdById: adminId,
      },
    });
    const key = `idem-${Date.now()}`;
    const o1 = await orders.createBuyOrder(userId, listing.id, 2, key);
    const o2 = await orders.createBuyOrder(userId, listing.id, 2, key);
    expect(o1.id).toBe(o2.id);
    await orders.rejectBuyOrder(adminId, o1.id, 'cleanup');
    await prisma.buyListing.delete({ where: { id: listing.id } }).catch(() => undefined);
  });
});
