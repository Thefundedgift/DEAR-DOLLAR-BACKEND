import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { CustomerGuard } from '../common/guards';
import { CreateDepositDto, CreateWithdrawalDto, SubmitUtrDto } from '../common/dto';
import { WalletService } from './wallet.service';
import { PrismaService } from '../prisma.service';

@Controller('wallet')
@UseGuards(CustomerGuard)
export class WalletController {
  constructor(private wallet: WalletService, private prisma: PrismaService) {}

  @Get()
  async getWallet(@Req() req: any) {
    const w = await this.prisma.moneyWallet.findUnique({ where: { userId: req.user.id } });
    return { availableBalance: w.availableBalance, pendingBalance: w.pendingBalance, currency: 'INR' };
  }

  @Get('transactions')
  async transactions(@Req() req: any, @Query('page') page = '1') {
    const w = await this.prisma.moneyWallet.findUnique({ where: { userId: req.user.id } });
    const take = 50;
    const skip = (Math.max(parseInt(page, 10) || 1, 1) - 1) * take;
    const [items, total] = await Promise.all([
      this.prisma.moneyWalletTransaction.findMany({ where: { walletId: w.id }, orderBy: { createdAt: 'desc' }, take, skip }),
      this.prisma.moneyWalletTransaction.count({ where: { walletId: w.id } }),
    ]);
    return { items, total };
  }

  @Post('deposits')
  createDeposit(@Req() req: any, @Body() dto: CreateDepositDto, @Headers('idempotency-key') idemKey?: string) {
    return this.wallet.createDeposit(req.user.id, dto.amount, idemKey);
  }

  @Get('deposits')
  listDeposits(@Req() req: any) {
    return this.wallet.listDeposits(req.user.id);
  }

  @Post('deposits/:id/utr')
  submitUtr(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SubmitUtrDto) {
    return this.wallet.submitUtr(req.user.id, id, dto.utr);
  }

  @Post('withdrawals')
  createWithdrawal(@Req() req: any, @Body() dto: CreateWithdrawalDto, @Headers('idempotency-key') idemKey?: string) {
    return this.wallet.createWithdrawal(req.user.id, dto.amount, dto.bankDetailId, idemKey);
  }

  @Get('withdrawals')
  listWithdrawals(@Req() req: any) {
    return this.wallet.listWithdrawals(req.user.id);
  }
}

@Controller('payments')
@UseGuards(CustomerGuard)
export class PaymentsController {
  constructor(private wallet: WalletService) {}

  @Get()
  list(@Req() req: any) {
    return this.wallet.listDeposits(req.user.id);
  }
}

@Controller('payment-settings')
@UseGuards(CustomerGuard)
export class PaymentSettingsController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async active() {
    const s = await this.prisma.paymentSettings.findFirst({ where: { isActive: true }, orderBy: { version: 'desc' } });
    if (!s) return { configured: false };
    return {
      configured: true,
      upiId: s.upiId,
      merchantName: s.merchantName,
      qrImageUrl: s.qrImagePath ? `/api/uploads/${s.qrImagePath}` : null,
      instructions: s.instructions,
      version: s.version,
    };
  }
}
