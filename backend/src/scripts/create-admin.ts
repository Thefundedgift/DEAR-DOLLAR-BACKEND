import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const PERMISSIONS = [
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
];

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function main() {
  const email = (getArg('email') || process.env.ADMIN_EMAIL || '').toLowerCase().trim();
  const password = getArg('password') || process.env.ADMIN_PASSWORD || '';
  const name = getArg('name') || process.env.ADMIN_NAME || 'Administrator';
  const role = (getArg('role') || process.env.ADMIN_ROLE || 'SUPER_ADMIN').toUpperCase();

  if (!email || !password) {
    console.error('Usage: node dist/scripts/create-admin.js --email admin@example.com --password <password> [--name Name] [--role SUPER_ADMIN|ADMIN]');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('Password must be at least 8 characters');
    process.exit(1);
  }
  if (!['SUPER_ADMIN', 'ADMIN'].includes(role)) {
    console.error('Role must be SUPER_ADMIN or ADMIN');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const admin = await prisma.admin.upsert({
    where: { email },
    create: { email, name, passwordHash, role: role as any, permissions: role === 'SUPER_ADMIN' ? PERMISSIONS : [] },
    update: { passwordHash, role: role as any, isActive: true },
  });
  console.log(`Admin ready: ${admin.email} (role: ${admin.role})`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
