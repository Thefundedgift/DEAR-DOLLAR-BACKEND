import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { DEPOSIT_MAX, DEPOSIT_MIN, PERMISSIONS } from './constants';

const MOBILE_REGEX = /^[6-9]\d{9}$/;

export class RegisterDto {
  @Matches(MOBILE_REGEX, { message: 'Mobile must be a valid 10-digit Indian mobile number' })
  mobile: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(72)
  password: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;
}

export class LoginDto {
  @Matches(MOBILE_REGEX, { message: 'Mobile must be a valid 10-digit Indian mobile number' })
  mobile: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}

export class RefreshDto {
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}

export class ForgotPasswordDto {
  @Matches(MOBILE_REGEX, { message: 'Mobile must be a valid 10-digit Indian mobile number' })
  mobile: string;
}

export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty()
  token: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  newPassword: string;
}

export class AdminLoginDto {
  @IsString()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}

export class CreateDepositDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(DEPOSIT_MIN, { message: `Minimum deposit is ₹${DEPOSIT_MIN}` })
  @Max(DEPOSIT_MAX, { message: `Maximum deposit is ₹${DEPOSIT_MAX}` })
  amount: number;
}

export class SubmitUtrDto {
  @Matches(/^[A-Za-z0-9]{6,30}$/, { message: 'UTR must be 6-30 alphanumeric characters' })
  utr: string;
}

export class CreateWithdrawalDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(DEPOSIT_MIN, { message: `Minimum withdrawal is ₹${DEPOSIT_MIN}` })
  @Max(DEPOSIT_MAX, { message: `Maximum withdrawal is ₹${DEPOSIT_MAX}` })
  amount: number;

  @IsUUID()
  bankDetailId: string;
}

export class ApproveWithdrawalDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  payoutReference?: string;
}

export class CreateOrderDto {
  @IsUUID()
  listingId: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  points: number;
}

export class CreateListingDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  moneyValue: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  pointQuantity: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  availableQuantity: number;

  @IsISO8601()
  startDate: string;

  @IsISO8601()
  endDate: string;
}

export class UpdateListingStatusDto {
  @IsIn(['ACTIVE', 'INACTIVE', 'EXPIRED'])
  status: string;
}

export class RejectDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class BankDetailDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  accountHolder: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  bankName: string;

  @Matches(/^\d{9,18}$/, { message: 'Account number must be 9-18 digits' })
  accountNumber: string;

  @Matches(/^[A-Z]{4}0[A-Z0-9]{6}$/, { message: 'Invalid IFSC code' })
  ifsc: string;

  @IsOptional()
  @Matches(/^[\w.\-]{2,50}@[a-zA-Z]{2,30}$/, { message: 'Invalid UPI ID' })
  upiId?: string;
}

export class PaymentSettingsDto {
  @Matches(/^[\w.\-]{2,50}@[a-zA-Z]{2,30}$/, { message: 'Invalid UPI ID' })
  upiId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  merchantName: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  instructions?: string;
}

export class CreateAdminDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, { message: 'Invalid email' })
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsIn(['SUPER_ADMIN', 'ADMIN'])
  role: string;

  @IsOptional()
  @IsIn(PERMISSIONS as unknown as string[], { each: true })
  permissions?: string[];
}

export class UpdateAdminDto {
  @IsOptional()
  @IsIn(['SUPER_ADMIN', 'ADMIN'])
  role?: string;

  @IsOptional()
  @IsIn(PERMISSIONS as unknown as string[], { each: true })
  permissions?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password?: string;
}

export class WalletAdjustmentDto {
  @IsUUID()
  userId: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount: number;

  @IsIn(['CREDIT', 'DEBIT'])
  direction: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

export class SocialLinkDto {
  @IsUrl({ require_protocol: true }, { message: 'URL must include protocol (https://)' })
  @MaxLength(500)
  url: string;

  @IsBoolean()
  enabled: boolean;
}

export class SocialLinkCreateDto extends SocialLinkDto {
  @IsEnum({ TELEGRAM: 'TELEGRAM', DISCORD: 'DISCORD' })
  platform: 'TELEGRAM' | 'DISCORD';
}
