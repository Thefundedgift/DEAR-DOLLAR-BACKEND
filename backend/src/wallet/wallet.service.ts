import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DollarTxType, MoneyTxType, Prisma, TxStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma.service';
import { dec, maskAccountNumber } from '../common/calc';

type Tx = Prisma.TransactionClient;

@Injectable()
export class WalletService {
  constructor(public prisma: PrismaService) {}

  async creditMoney(tx: Tx, userId: string, amount: Prisma.Decimal, type: MoneyTxType, reference: string, status: TxStatus = 'COMPLETED', description?: string) {
    const wallet = await tx.moneyWallet.findUnique({ where: { userId } });
    if (!wallet) throw new NotFoundException('Money wallet not found');
    await tx.$executeRaw`UPDATE money_wallets SET available_balance = available_balance + ${amount.toString()}::numeric, updated_at = now() WHERE id = ${wallet.id}`;
    const after = await tx.moneyWallet.findUnique({ where: { id: wallet.id } });
    return tx.moneyWalletTransaction.create({
      data: { walletId: wallet.id, type, direction: 'CREDIT', amount, balanceAfter: after.availableBalance, status, reference, description },
    });
  }

  async debitMoney(tx: Tx, userId: string, amount: Prisma.Decimal, type: MoneyTxType, reference: string, status: TxStatus = 'COMPLETED', description?: string) {
    const wallet = await tx.moneyWallet.findUnique({ where: { userId } });
    if (!wallet) throw new NotFoundException('Money wallet not found');
    const updated = await tx.$executeRaw`UPDATE money_wallets SET available_balance = available_balance - ${amount.toString()}::numeric, updated_at = now() WHERE id = ${wallet.id} AND available_balance >= ${amount.toString()}::numeric`;
    if (!updated) throw new BadRequestException('Insufficient wallet balance');
    const after = await tx.moneyWallet.findUnique({ where: { id: wallet.id } });
    return tx.moneyWalletTransaction.create({
      data: { walletId: wallet.id, type, direction: 'DEBIT', amount, balanceAfter: after.availableBalance, status, reference, description },
    });
  }

  async creditPoints(tx: Tx, userId: string, points: Prisma.Decimal, type: DollarTxType, rate: Prisma.Decimal, moneyValue: Prisma.Decimal, referenceId: string, status: TxStatus = 'COMPLETED', description?: string) {
    const wallet = await tx.dollarWallet.findUnique({ where: { userId } });
    if (!wallet) throw new NotFoundException('$DOLLAR wallet not found');
    await tx.$executeRaw`UPDATE dollar_wallets SET available_points = available_points + ${points.toString()}::numeric, updated_at = now() WHERE id = ${wallet.id}`;
    const after = await tx.dollarWallet.findUnique({ where: { id: wallet.id } });
    return tx.dollarWalletTransaction.create({
      data: { walletId: wallet.id, type, direction: 'CREDIT', points, rateAtTransaction: rate, moneyValue, balanceAfter: after.availablePoints, status, referenceId, description },
    });
  }

  async debitPoints(tx: Tx, userId: string, points: Prisma.Decimal, type: DollarTxType, rate: Prisma.Decimal, moneyValue: Prisma.Decimal, referenceId: string, status: TxStatus = 'COMPLETED', description?: string) {
    const wallet = await tx.dollarWallet.findUnique({ where: { userId } });
    if (!wallet) throw new NotFoundException('$DOLLAR wallet not found');
    const updated = await tx.$executeRaw`UPDATE dollar_wallets SET available_points = available_points - ${points.toString()}::numeric, updated_at = now() WHERE id = ${wallet.id} AND available_points >= ${points.toString()}::numeric`;
    if (!updated) throw new BadRequestException('Insufficient $DOLLAR points');
    const after = await tx.dollarWallet.findUnique({ where: { id: wallet.id } });
    return tx.dollarWalletTransaction.create({
      data: { walletId: wallet.id, type, direction: 'DEBIT', points, rateAtTransaction: rate, moneyValue, balanceAfter: after.availablePoints, status, referenceId, description },
    });
  }

  async createDeposit(userId: string, amount: number, idempotencyKey?: string) {
    if (idempotencyKey) {
      const existing = await this.prisma.deposit.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } } });
      if (existing) return this.depositView(existing);
    }
    const settings = await this.prisma.paymentSettings.findFirst({ where: { isActive: true }, orderBy: { version: 'desc' } });
    if (!settings) throw new BadRequestException('Payments are not configured yet. Please try again later.');
    const deposit = await this.prisma.deposit.create({
      data: {
        userId,
        amount: dec(amount),
        upiIdUsed: settings.upiId,
        merchantName: settings.merchantName,
        qrImagePath: settings.qrImagePath,
        settingsVersion: settings.version,
        idempotencyKey: idempotencyKey || null,
      },
    });
    return this.depositView(deposit, settings.instructions);
  }

  depositView(d: any, instructions?: string) {
    return {
      id: d.id,
      amount: d.amount,
      upiId: d.upiIdUsed,
      merchantName: d.merchantName,
      qrImageUrl: d.qrImagePath ? `/api/uploads/${d.qrImagePath}` : null,
      settingsVersion: d.settingsVersion,
      utr: d.utr,
      status: d.status,
      instructions: instructions || undefined,
      submittedAt: d.submittedAt,
      verifiedAt: d.verifiedAt,
      rejectedReason: d.rejectedReason,
      createdAt: d.createdAt,
    };
  }

  async submitUtr(userId: string, depositId: string, utr: string) {
    const deposit = await this.prisma.deposit.findFirst({ where: { id: depositId, userId } });
    if (!deposit) throw new NotFoundException('Deposit not found');
    if (deposit.status !== 'PENDING') throw new BadRequestException(`Deposit already ${deposit.status.toLowerCase()}`);
    const updated = await this.prisma.deposit.update({
      where: { id: deposit.id },
      data: { utr, submittedAt: new Date() },
    });
    return this.depositView(updated);
  }

  async listDeposits(userId: string) {
    const deposits = await this.prisma.deposit.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 100 });
    return deposits.map((d) => this.depositView(d));
  }

  withdrawalView(w: any) {
    return {
      id: w.id,
      amount: w.amount,
      accountHolder: w.accountHolder,
      bankName: w.bankName,
      accountNumber: maskAccountNumber(w.accountNumber),
      ifsc: w.ifsc,
      upiId: w.upiId,
      status: w.status,
      payoutReference: w.payoutReference,
      rejectedReason: w.rejectedReason,
      processedAt: w.processedAt,
      createdAt: w.createdAt,
    };
  }

  async createWithdrawal(userId: string, amount: number, bankDetailId: string, idempotencyKey?: string) {
    if (idempotencyKey) {
      const existing = await this.prisma.withdrawal.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } } });
      if (existing) return this.withdrawalView(existing);
    }
    const bank = await this.prisma.bankDetail.findFirst({ where: { id: bankDetailId, userId } });
    if (!bank) throw new NotFoundException('Bank detail not found. Save your bank account first.');
    const amountDec = dec(amount);
    const withdrawal = await this.prisma.$transaction(async (tx) => {
      const withdrawalId = randomUUID();
      await this.debitMoney(tx, userId, amountDec, 'SETTLEMENT', withdrawalId, 'PENDING', `Withdrawal to ${bank.bankName} a/c ending ${bank.accountNumber.slice(-4)}`);
      return tx.withdrawal.create({
        data: {
          id: withdrawalId,
          userId,
          amount: amountDec,
          bankDetailId: bank.id,
          accountHolder: bank.accountHolder,
          bankName: bank.bankName,
          accountNumber: bank.accountNumber,
          ifsc: bank.ifsc,
          upiId: bank.upiId,
          idempotencyKey: idempotencyKey || null,
        },
      });
    }, { timeout: 15000 });
    return this.withdrawalView(withdrawal);
  }

  async listWithdrawals(userId: string) {
    const items = await this.prisma.withdrawal.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 100 });
    return items.map((w) => this.withdrawalView(w));
  }
}
