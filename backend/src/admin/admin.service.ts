import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { AuthService } from '../auth/auth.service';
import { AuditService } from '../audit.service';
import { dec } from '../common/calc';
import { PERMISSIONS } from '../common/constants';
import { safeAdmin } from './admin-auth';

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private wallet: WalletService,
    private auth: AuthService,
    private audit: AuditService,
  ) {}

  // ---------- Customers ----------
  async listCustomers(search?: string, page = 1) {
    const take = 50;
    const where = search
      ? { OR: [{ mobile: { contains: search } }, { name: { contains: search, mode: 'insensitive' as any } }] }
      : {};
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip: (Math.max(page, 1) - 1) * take,
        include: { moneyWallet: true, dollarWallet: true },
      }),
      this.prisma.user.count({ where }),
    ]);
    return {
      total,
      items: items.map((u) => ({
        id: u.id,
        mobile: u.mobile,
        name: u.name,
        status: u.status,
        createdAt: u.createdAt,
        moneyBalance: u.moneyWallet?.availableBalance,
        dollarPoints: u.dollarWallet?.availablePoints,
      })),
    };
  }

  async getCustomer(id: string) {
    const u = await this.prisma.user.findUnique({ where: { id }, include: { moneyWallet: true, dollarWallet: true } });
    if (!u) throw new NotFoundException('Customer not found');
    const [buyCount, sellCount, depositCount] = await Promise.all([
      this.prisma.buyOrder.count({ where: { userId: id } }),
      this.prisma.sellOrder.count({ where: { userId: id } }),
      this.prisma.deposit.count({ where: { userId: id } }),
    ]);
    return {
      id: u.id,
      mobile: u.mobile,
      name: u.name,
      status: u.status,
      createdAt: u.createdAt,
      moneyWallet: u.moneyWallet,
      dollarWallet: u.dollarWallet,
      counts: { buyOrders: buyCount, sellOrders: sellCount, deposits: depositCount },
    };
  }

  async setUserStatus(adminId: string, userId: string, status: 'ACTIVE' | 'BLOCKED', ip?: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u) throw new NotFoundException('Customer not found');
    await this.prisma.user.update({ where: { id: userId }, data: { status } });
    await this.audit.log({ adminId, action: status === 'BLOCKED' ? 'USER_BLOCKED' : 'USER_UNBLOCKED', entityType: 'User', entityId: userId, ip });
    return { message: `Customer ${status.toLowerCase()}` };
  }

  async generateResetToken(adminId: string, userId: string, ip?: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u) throw new NotFoundException('Customer not found');
    const token = await this.auth.createResetToken(userId, adminId);
    await this.audit.log({ adminId, action: 'PASSWORD_RESET_TOKEN_GENERATED', entityType: 'User', entityId: userId, ip });
    return {
      resetToken: token,
      expiresInMinutes: 30,
      note: 'Share this single-use token with the customer over a secure channel. It expires in 30 minutes.',
    };
  }

  async adjustWallet(adminId: string, dto: { userId: string; amount: number; direction: string; reason: string }, ip?: string) {
    const amount = dec(dto.amount);
    const result = await this.prisma.$transaction(async (tx) => {
      if (dto.direction === 'CREDIT') {
        return this.wallet.creditMoney(tx, dto.userId, amount, 'ADJUSTMENT', `admin:${adminId}`, 'COMPLETED', dto.reason);
      }
      return this.wallet.debitMoney(tx, dto.userId, amount, 'ADJUSTMENT', `admin:${adminId}`, 'COMPLETED', dto.reason);
    });
    await this.audit.log({
      adminId,
      action: 'WALLET_ADJUSTED',
      entityType: 'MoneyWallet',
      entityId: dto.userId,
      details: { amount: dto.amount, direction: dto.direction, reason: dto.reason },
      ip,
    });
    return result;
  }

  // ---------- Listings ----------
  private listingModel(kind: 'buy' | 'demand') {
    return kind === 'buy' ? this.prisma.buyListing : (this.prisma.demandListing as any);
  }

  async createListing(kind: 'buy' | 'demand', adminId: string, dto: any, ip?: string) {
    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);
    if (end <= start) throw new BadRequestException('endDate must be after startDate');
    const listing = await this.listingModel(kind).create({
      data: {
        title: dto.title,
        description: dto.description || null,
        moneyValue: dec(dto.moneyValue),
        pointQuantity: dec(dto.pointQuantity),
        availableQuantity: dec(dto.availableQuantity),
        remainingQuantity: dec(dto.availableQuantity),
        startDate: start,
        endDate: end,
        createdById: adminId,
      },
    });
    await this.audit.log({
      adminId,
      action: kind === 'buy' ? 'BUY_LISTING_CREATED' : 'DEMAND_LISTING_CREATED',
      entityType: kind === 'buy' ? 'BuyListing' : 'DemandListing',
      entityId: listing.id,
      details: { moneyValue: dto.moneyValue, pointQuantity: dto.pointQuantity, availableQuantity: dto.availableQuantity },
      ip,
    });
    return listing;
  }

  listListings(kind: 'buy' | 'demand') {
    return this.listingModel(kind).findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
  }

  async updateListingStatus(kind: 'buy' | 'demand', adminId: string, id: string, status: string, ip?: string) {
    const existing = await this.listingModel(kind).findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Listing not found');
    const listing = await this.listingModel(kind).update({ where: { id }, data: { status } });
    await this.audit.log({
      adminId,
      action: kind === 'buy' ? 'BUY_LISTING_STATUS_CHANGED' : 'DEMAND_LISTING_STATUS_CHANGED',
      entityType: kind === 'buy' ? 'BuyListing' : 'DemandListing',
      entityId: id,
      details: { from: existing.status, to: status },
      ip,
    });
    return listing;
  }

  // ---------- Deposits / payments ----------
  listDeposits(status?: string) {
    return this.prisma.deposit.findMany({
      where: status ? { status: status as any } : {},
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { user: { select: { id: true, mobile: true, name: true } } },
    });
  }

  async verifyDeposit(adminId: string, depositId: string, ip?: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.deposit.updateMany({
        where: { id: depositId, status: 'PENDING', NOT: { utr: null } },
        data: { status: 'VERIFIED', verifiedById: adminId, verifiedAt: new Date() },
      });
      if (!claimed.count) throw new ConflictException('Deposit is not pending with a submitted UTR');
      const deposit = await tx.deposit.findUnique({ where: { id: depositId } });
      await this.wallet.creditMoney(tx, deposit.userId, deposit.amount, 'UPI_DEPOSIT', deposit.id, 'COMPLETED', `UPI deposit verified (UTR ${deposit.utr})`);
      return deposit;
    }, { timeout: 15000 });
    await this.audit.log({ adminId, action: 'PAYMENT_VERIFIED', entityType: 'Deposit', entityId: depositId, details: { amount: result.amount, utr: result.utr }, ip });
    return { message: 'Deposit verified and wallet credited', depositId };
  }

  async rejectDeposit(adminId: string, depositId: string, reason?: string, ip?: string) {
    const claimed = await this.prisma.deposit.updateMany({
      where: { id: depositId, status: 'PENDING' },
      data: { status: 'REJECTED', verifiedById: adminId, verifiedAt: new Date(), rejectedReason: reason || null },
    });
    if (!claimed.count) throw new ConflictException('Deposit is not pending');
    await this.audit.log({ adminId, action: 'PAYMENT_REJECTED', entityType: 'Deposit', entityId: depositId, details: { reason }, ip });
    return { message: 'Deposit rejected', depositId };
  }

  // ---------- Payment settings ----------
  async createPaymentSettings(adminId: string, dto: { upiId: string; merchantName: string; instructions?: string }, qrImagePath?: string, ip?: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const latest = await tx.paymentSettings.findFirst({ orderBy: { version: 'desc' } });
      await tx.paymentSettings.updateMany({ where: { isActive: true }, data: { isActive: false } });
      return tx.paymentSettings.create({
        data: {
          version: (latest?.version || 0) + 1,
          upiId: dto.upiId,
          merchantName: dto.merchantName,
          qrImagePath: qrImagePath || latest?.qrImagePath || null,
          instructions: dto.instructions || null,
          updatedById: adminId,
        },
      });
    });
    await this.audit.log({
      adminId,
      action: 'PAYMENT_SETTINGS_UPDATED',
      entityType: 'PaymentSettings',
      entityId: result.id,
      details: { version: result.version, upiId: dto.upiId, qrChanged: !!qrImagePath },
      ip,
    });
    return result;
  }

  listPaymentSettings() {
    return this.prisma.paymentSettings.findMany({ orderBy: { version: 'desc' }, take: 50 });
  }

  // ---------- Orders ----------
  listBuyOrders(status?: string) {
    return this.prisma.buyOrder.findMany({
      where: status ? { status: status as any } : {},
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { user: { select: { id: true, mobile: true, name: true } }, listing: { select: { title: true } } },
    });
  }

  listSellOrders(status?: string) {
    return this.prisma.sellOrder.findMany({
      where: status ? { status: status as any } : {},
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { user: { select: { id: true, mobile: true, name: true } }, listing: { select: { title: true } } },
    });
  }

  // ---------- Reports ----------
  async reportsSummary() {
    const [customers, activeCustomers, moneyAgg, pointsAgg, depositGroups, buyGroups, sellGroups, verifiedDeposits] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { status: 'ACTIVE' } }),
      this.prisma.moneyWallet.aggregate({ _sum: { availableBalance: true } }),
      this.prisma.dollarWallet.aggregate({ _sum: { availablePoints: true } }),
      this.prisma.deposit.groupBy({ by: ['status'], _count: true, _sum: { amount: true } }),
      this.prisma.buyOrder.groupBy({ by: ['status'], _count: true, _sum: { moneyAmount: true, points: true } }),
      this.prisma.sellOrder.groupBy({ by: ['status'], _count: true, _sum: { moneyAmount: true, points: true } }),
      this.prisma.deposit.aggregate({ where: { status: 'VERIFIED' }, _sum: { amount: true } }),
    ]);
    return {
      customers: { total: customers, active: activeCustomers },
      wallets: { totalMoneyBalance: moneyAgg._sum.availableBalance || 0, totalDollarPoints: pointsAgg._sum.availablePoints || 0 },
      deposits: { byStatus: depositGroups, totalVerifiedAmount: verifiedDeposits._sum.amount || 0 },
      buyOrders: { byStatus: buyGroups },
      sellOrders: { byStatus: sellGroups },
    };
  }

  listAuditLogs(page = 1, action?: string) {
    const take = 100;
    return this.prisma.auditLog.findMany({
      where: action ? { action } : {},
      orderBy: { createdAt: 'desc' },
      take,
      skip: (Math.max(page, 1) - 1) * take,
    });
  }

  // ---------- Admin management ----------
  async listAdmins() {
    const admins = await this.prisma.admin.findMany({ orderBy: { createdAt: 'desc' } });
    return admins.map(safeAdmin);
  }

  async createAdmin(actorId: string, dto: any, ip?: string) {
    const email = dto.email.toLowerCase().trim();
    const existing = await this.prisma.admin.findUnique({ where: { email } });
    if (existing) throw new ConflictException('Admin email already exists');
    const admin = await this.prisma.admin.create({
      data: {
        email,
        name: dto.name,
        passwordHash: await argon2.hash(dto.password, { type: argon2.argon2id }),
        role: dto.role,
        permissions: dto.role === 'SUPER_ADMIN' ? [...PERMISSIONS] : dto.permissions || [],
      },
    });
    await this.audit.log({ adminId: actorId, action: 'ADMIN_CREATED', entityType: 'Admin', entityId: admin.id, details: { email, role: dto.role, permissions: admin.permissions }, ip });
    return safeAdmin(admin);
  }

  async updateAdmin(actorId: string, id: string, dto: any, ip?: string) {
    const existing = await this.prisma.admin.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Admin not found');
    const data: any = {};
    if (dto.role) data.role = dto.role;
    if (dto.permissions) data.permissions = dto.permissions;
    if (typeof dto.isActive === 'boolean') data.isActive = dto.isActive;
    if (dto.password) data.passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
    const admin = await this.prisma.admin.update({ where: { id }, data });
    await this.audit.log({
      adminId: actorId,
      action: 'ADMIN_UPDATED',
      entityType: 'Admin',
      entityId: id,
      details: { role: dto.role, permissions: dto.permissions, isActive: dto.isActive, passwordChanged: !!dto.password },
      ip,
    });
    return safeAdmin(admin);
  }
}
