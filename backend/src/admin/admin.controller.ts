import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { randomUUID } from 'crypto';
import { AdminGuard, PermissionsGuard, RequirePermissions, SuperAdminOnly } from '../common/guards';
import {
  CreateAdminDto,
  CreateListingDto,
  PaymentSettingsDto,
  RejectDto,
  UpdateAdminDto,
  UpdateListingStatusDto,
  WalletAdjustmentDto,
} from '../common/dto';
import { AdminService } from './admin.service';
import { OrdersService } from '../orders/orders.service';
import { AuditService } from '../audit.service';
import { getClientIp } from '../common/constants';

const qrUpload = {
  storage: diskStorage({
    destination: (req, file, cb) => cb(null, process.env.UPLOAD_DIR || 'uploads'),
    filename: (req, file, cb) => cb(null, `qr-${randomUUID()}${extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(png|jpe?g|webp)$/.test(file.mimetype)) cb(null, true);
    else cb(new BadRequestException('QR image must be PNG, JPG or WEBP'), false);
  },
};

@Controller('admin/users')
@UseGuards(AdminGuard, PermissionsGuard)
export class AdminUsersController {
  constructor(private admin: AdminService) {}

  @Get()
  @RequirePermissions('VIEW_CUSTOMERS')
  list(@Query('search') search?: string, @Query('page') page = '1') {
    return this.admin.listCustomers(search, parseInt(page, 10) || 1);
  }

  @Get(':id')
  @RequirePermissions('VIEW_CUSTOMERS')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.getCustomer(id);
  }

  @Post(':id/block')
  @RequirePermissions('VIEW_CUSTOMERS')
  block(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.admin.setUserStatus(req.admin.id, id, 'BLOCKED', getClientIp(req));
  }

  @Post(':id/unblock')
  @RequirePermissions('VIEW_CUSTOMERS')
  unblock(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.admin.setUserStatus(req.admin.id, id, 'ACTIVE', getClientIp(req));
  }

  @Post(':id/password-reset')
  @RequirePermissions('VIEW_CUSTOMERS')
  resetToken(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.admin.generateResetToken(req.admin.id, id, getClientIp(req));
  }

  @Post('wallet-adjustment')
  @SuperAdminOnly()
  adjust(@Req() req: any, @Body() dto: WalletAdjustmentDto) {
    return this.admin.adjustWallet(req.admin.id, dto, getClientIp(req));
  }
}

@Controller('admin/buy-listings')
@UseGuards(AdminGuard, PermissionsGuard)
@RequirePermissions('MANAGE_BUY_LISTINGS')
export class AdminBuyListingsController {
  constructor(private admin: AdminService) {}

  @Get()
  list() {
    return this.admin.listListings('buy');
  }

  @Post()
  create(@Req() req: any, @Body() dto: CreateListingDto) {
    return this.admin.createListing('buy', req.admin.id, dto, getClientIp(req));
  }

  @Patch(':id/status')
  status(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateListingStatusDto) {
    return this.admin.updateListingStatus('buy', req.admin.id, id, dto.status, getClientIp(req));
  }
}

@Controller('admin/demand-listings')
@UseGuards(AdminGuard, PermissionsGuard)
@RequirePermissions('MANAGE_DEMAND_LISTINGS')
export class AdminDemandListingsController {
  constructor(private admin: AdminService) {}

  @Get()
  list() {
    return this.admin.listListings('demand');
  }

  @Post()
  create(@Req() req: any, @Body() dto: CreateListingDto) {
    return this.admin.createListing('demand', req.admin.id, dto, getClientIp(req));
  }

  @Patch(':id/status')
  status(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateListingStatusDto) {
    return this.admin.updateListingStatus('demand', req.admin.id, id, dto.status, getClientIp(req));
  }
}

@Controller('admin/buy-orders')
@UseGuards(AdminGuard, PermissionsGuard)
export class AdminBuyOrdersController {
  constructor(private admin: AdminService, private orders: OrdersService, private audit: AuditService) {}

  @Get()
  @RequirePermissions('APPROVE_BUY')
  list(@Query('status') status?: string) {
    return this.admin.listBuyOrders(status);
  }

  @Post(':id/approve')
  @RequirePermissions('APPROVE_BUY')
  async approve(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    const order = await this.orders.approveBuyOrder(req.admin.id, id);
    await this.audit.log({ adminId: req.admin.id, action: 'BUY_ORDER_APPROVED', entityType: 'BuyOrder', entityId: id, details: { points: order.points, moneyAmount: order.moneyAmount }, ip: getClientIp(req) });
    return order;
  }

  @Post(':id/reject')
  @RequirePermissions('APPROVE_BUY')
  async reject(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectDto) {
    const order = await this.orders.rejectBuyOrder(req.admin.id, id, dto.reason);
    await this.audit.log({ adminId: req.admin.id, action: 'BUY_ORDER_REJECTED', entityType: 'BuyOrder', entityId: id, details: { reason: dto.reason }, ip: getClientIp(req) });
    return order;
  }
}

@Controller('admin/sell-orders')
@UseGuards(AdminGuard, PermissionsGuard)
export class AdminSellOrdersController {
  constructor(private admin: AdminService, private orders: OrdersService, private audit: AuditService) {}

  @Get()
  @RequirePermissions('APPROVE_SELL')
  list(@Query('status') status?: string) {
    return this.admin.listSellOrders(status);
  }

  @Post(':id/approve')
  @RequirePermissions('APPROVE_SELL')
  async approve(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    const order = await this.orders.approveSellOrder(req.admin.id, id);
    await this.audit.log({ adminId: req.admin.id, action: 'SELL_ORDER_APPROVED', entityType: 'SellOrder', entityId: id, details: { points: order.points, moneyAmount: order.moneyAmount }, ip: getClientIp(req) });
    return order;
  }

  @Post(':id/reject')
  @RequirePermissions('APPROVE_SELL')
  async reject(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectDto) {
    const order = await this.orders.rejectSellOrder(req.admin.id, id, dto.reason);
    await this.audit.log({ adminId: req.admin.id, action: 'SELL_ORDER_REJECTED', entityType: 'SellOrder', entityId: id, details: { reason: dto.reason }, ip: getClientIp(req) });
    return order;
  }
}

@Controller('admin/payments')
@UseGuards(AdminGuard, PermissionsGuard)
@RequirePermissions('VERIFY_PAYMENTS')
export class AdminPaymentsController {
  constructor(private admin: AdminService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.admin.listDeposits(status);
  }

  @Post(':id/verify')
  verify(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.admin.verifyDeposit(req.admin.id, id, getClientIp(req));
  }

  @Post(':id/reject')
  reject(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectDto) {
    return this.admin.rejectDeposit(req.admin.id, id, dto.reason, getClientIp(req));
  }
}

@Controller('admin/payment-settings')
@UseGuards(AdminGuard, PermissionsGuard)
@RequirePermissions('MANAGE_PAYMENT_SETTINGS')
export class AdminPaymentSettingsController {
  constructor(private admin: AdminService) {}

  @Get()
  list() {
    return this.admin.listPaymentSettings();
  }

  @Post()
  @UseInterceptors(FileInterceptor('qrImage', qrUpload))
  create(@Req() req: any, @Body() dto: PaymentSettingsDto, @UploadedFile() file?: Express.Multer.File) {
    return this.admin.createPaymentSettings(req.admin.id, dto, file?.filename, getClientIp(req));
  }
}

@Controller('admin/reports')
@UseGuards(AdminGuard, PermissionsGuard)
@RequirePermissions('VIEW_REPORTS')
export class AdminReportsController {
  constructor(private admin: AdminService) {}

  @Get('summary')
  summary() {
    return this.admin.reportsSummary();
  }
}

@Controller('admin/audit-logs')
@UseGuards(AdminGuard, PermissionsGuard)
@RequirePermissions('VIEW_AUDIT_LOGS')
export class AdminAuditLogsController {
  constructor(private admin: AdminService) {}

  @Get()
  list(@Query('page') page = '1', @Query('action') action?: string) {
    return this.admin.listAuditLogs(parseInt(page, 10) || 1, action);
  }
}

@Controller('admin/admins')
@UseGuards(AdminGuard, PermissionsGuard)
@RequirePermissions('MANAGE_ADMINS')
export class AdminAdminsController {
  constructor(private admin: AdminService) {}

  @Get()
  list() {
    return this.admin.listAdmins();
  }

  @Post()
  create(@Req() req: any, @Body() dto: CreateAdminDto) {
    return this.admin.createAdmin(req.admin.id, dto, getClientIp(req));
  }

  @Patch(':id')
  update(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAdminDto) {
    return this.admin.updateAdmin(req.admin.id, id, dto, getClientIp(req));
  }
}
