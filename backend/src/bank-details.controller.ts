import { Body, Controller, Delete, Get, NotFoundException, Param, ParseUUIDPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { CustomerGuard } from './common/guards';
import { BankDetailDto } from './common/dto';
import { PrismaService } from './prisma.service';
import { maskAccountNumber } from './common/calc';

function view(b: any) {
  return {
    id: b.id,
    accountHolder: b.accountHolder,
    bankName: b.bankName,
    accountNumber: maskAccountNumber(b.accountNumber),
    ifsc: b.ifsc,
    upiId: b.upiId,
    createdAt: b.createdAt,
  };
}

@Controller('bank-details')
@UseGuards(CustomerGuard)
export class BankDetailsController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async list(@Req() req: any) {
    const items = await this.prisma.bankDetail.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'desc' } });
    return items.map(view);
  }

  @Post()
  async create(@Req() req: any, @Body() dto: BankDetailDto) {
    const item = await this.prisma.bankDetail.create({ data: { userId: req.user.id, ...dto } });
    return view(item);
  }

  @Put(':id')
  async update(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BankDetailDto) {
    const existing = await this.prisma.bankDetail.findFirst({ where: { id, userId: req.user.id } });
    if (!existing) throw new NotFoundException('Bank detail not found');
    const item = await this.prisma.bankDetail.update({ where: { id }, data: { ...dto } });
    return view(item);
  }

  @Delete(':id')
  async remove(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    const existing = await this.prisma.bankDetail.findFirst({ where: { id, userId: req.user.id } });
    if (!existing) throw new NotFoundException('Bank detail not found');
    await this.prisma.bankDetail.delete({ where: { id } });
    return { message: 'Deleted' };
  }
}
