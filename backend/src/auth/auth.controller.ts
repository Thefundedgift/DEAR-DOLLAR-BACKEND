import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService, safeUser } from './auth.service';
import { CustomerGuard } from '../common/guards';
import { ForgotPasswordDto, LoginDto, RefreshDto, RegisterDto, ResetPasswordDto } from '../common/dto';
import { PrismaService } from '../prisma.service';

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService, private prisma: PrismaService) {}

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @UseGuards(CustomerGuard)
  @Post('logout')
  logout(@Body() dto: RefreshDto) {
    return this.auth.logout(dto.refreshToken);
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto.mobile);
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto.token, dto.newPassword);
  }

  @UseGuards(CustomerGuard)
  @Get('me')
  async me(@Req() req: any) {
    const [moneyWallet, dollarWallet] = await Promise.all([
      this.prisma.moneyWallet.findUnique({ where: { userId: req.user.id } }),
      this.prisma.dollarWallet.findUnique({ where: { userId: req.user.id } }),
    ]);
    return {
      user: safeUser(req.user),
      moneyWallet: moneyWallet && {
        availableBalance: moneyWallet.availableBalance,
        pendingBalance: moneyWallet.pendingBalance,
      },
      dollarWallet: dollarWallet && {
        availablePoints: dollarWallet.availablePoints,
        pendingPoints: dollarWallet.pendingPoints,
      },
    };
  }
}

@Controller('users')
@UseGuards(CustomerGuard)
export class UsersController {
  @Get('me')
  me(@Req() req: any) {
    return safeUser(req.user);
  }
}
