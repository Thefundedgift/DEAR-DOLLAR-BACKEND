import { Body, Controller, Get, Headers, Post, Req, UseGuards } from '@nestjs/common';
import { CustomerGuard } from '../common/guards';
import { CreateOrderDto } from '../common/dto';
import { OrdersService } from './orders.service';

@Controller('buy-orders')
@UseGuards(CustomerGuard)
export class BuyOrdersController {
  constructor(private orders: OrdersService) {}

  @Post()
  create(@Req() req: any, @Body() dto: CreateOrderDto, @Headers('idempotency-key') idemKey?: string) {
    return this.orders.createBuyOrder(req.user.id, dto.listingId, dto.points, idemKey);
  }

  @Get()
  list(@Req() req: any) {
    return this.orders.listBuyOrders(req.user.id);
  }
}

@Controller('sell-orders')
@UseGuards(CustomerGuard)
export class SellOrdersController {
  constructor(private orders: OrdersService) {}

  @Post()
  create(@Req() req: any, @Body() dto: CreateOrderDto, @Headers('idempotency-key') idemKey?: string) {
    return this.orders.createSellOrder(req.user.id, dto.listingId, dto.points, idemKey);
  }

  @Get()
  list(@Req() req: any) {
    return this.orders.listSellOrders(req.user.id);
  }
}
