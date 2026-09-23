import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
import { HealthController } from './health.controller';
import { TokenService } from './auth/token.service';
import { AuthService } from './auth/auth.service';
import { AuthController, UsersController } from './auth/auth.controller';
import { CustomerGuard, AdminGuard, PermissionsGuard } from './common/guards';
import { WalletService } from './wallet/wallet.service';
import { PaymentSettingsController, PaymentsController, WalletController } from './wallet/wallet.controller';
import { PointsController } from './points/points.controller';
import { OrdersService } from './orders/orders.service';
import { BuyOrdersController, SellOrdersController } from './orders/orders.controller';
import { BankDetailsController } from './bank-details.controller';
import { AuditService } from './audit.service';
import { AdminSocialLinksController, SocialLinksController } from './social-links.controller';
import { AdminAuthController, AdminAuthService } from './admin/admin-auth';
import { AdminService } from './admin/admin.service';
import {
  AdminAdminsController,
  AdminAuditLogsController,
  AdminBuyListingsController,
  AdminBuyOrdersController,
  AdminDemandListingsController,
  AdminPaymentSettingsController,
  AdminPaymentsController,
  AdminReportsController,
  AdminSellOrdersController,
  AdminUsersController,
} from './admin/admin.controller';

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: 300 }])],
  controllers: [
    HealthController,
    AuthController,
    UsersController,
    WalletController,
    PaymentsController,
    PaymentSettingsController,
    PointsController,
    BuyOrdersController,
    SellOrdersController,
    BankDetailsController,
    SocialLinksController,
    AdminAuthController,
    AdminUsersController,
    AdminBuyListingsController,
    AdminDemandListingsController,
    AdminBuyOrdersController,
    AdminSellOrdersController,
    AdminPaymentsController,
    AdminPaymentSettingsController,
    AdminReportsController,
    AdminAuditLogsController,
    AdminAdminsController,
    AdminSocialLinksController,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    PrismaService,
    RedisService,
    TokenService,
    AuthService,
    WalletService,
    OrdersService,
    AuditService,
    AdminAuthService,
    AdminService,
    CustomerGuard,
    AdminGuard,
    PermissionsGuard,
  ],
})
export class AppModule {}
