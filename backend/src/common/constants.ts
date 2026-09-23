export const PERMISSIONS = [
  'VIEW_CUSTOMERS',
  'VIEW_WALLETS',
  'VERIFY_PAYMENTS',
  'MANAGE_BUY_LISTINGS',
  'MANAGE_DEMAND_LISTINGS',
  'APPROVE_BUY',
  'APPROVE_SELL',
  'VIEW_REPORTS',
  'MANAGE_PAYMENT_SETTINGS',
  'MANAGE_ADMINS',
  'VIEW_AUDIT_LOGS',
] as const;

export const DEPOSIT_MIN = 200;
export const DEPOSIT_MAX = 100000;

export function getClientIp(req: any): string {
  const fwd = req.headers?.['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.ip || '';
}
