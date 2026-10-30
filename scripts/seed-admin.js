/* eslint-disable no-console */
import 'dotenv/config';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

// Default-admin bootstrap, run at container startup (after migrations).
//
// Context: the 01_init migration inserts upstream Umami's demo account —
// username 'admin' with the well-known bcrypt hash of the word 'umami'.
// Any deployment that relies on it alone ships a guessable admin.
//
// Contract (active only when DEFAULT_ADMIN_PASSWORD is set):
//   target user (DEFAULT_ADMIN_USERNAME, default "admin") not exists
//       -> create it with role 'admin'
//   target exists, password is still the public demo hash
//       -> take over: set it to DEFAULT_ADMIN_PASSWORD (first boot)
//   target exists, password is anything else
//       -> NEVER touch it (operator-rotated passwords survive restarts)
//   additionally, when the target is NOT 'admin':
//       -> soft-delete any 'admin' user still sitting on the demo hash
//          (a configured custom admin implies the public one must die)
//
// Without DEFAULT_ADMIN_PASSWORD the script is a silent no-op, preserving
// upstream behavior for anyone who wants it.

const SALT_ROUNDS = 10;

// Exact hash string shipped by prisma/migrations/01_init — bcrypt of 'umami'.
// Comparison is string-equality on the stored hash, never a login attempt.
const DEMO_HASH = '$2b$10$BUli0c.muyCW1ErNJc3jL.vFRFtFJWrT8/GcR4A.sUdCznaXiqFXa';

const password = process.env.DEFAULT_ADMIN_PASSWORD;

if (!password) {
  process.exit(0);
}

const username = process.env.DEFAULT_ADMIN_USERNAME || 'admin';

const url = new URL(process.env.DATABASE_URL);
const adapter = new PrismaPg(
  { connectionString: url.toString() },
  { schema: url.searchParams.get('schema') },
);
const prisma = new PrismaClient({ adapter });

async function findUser(name) {
  return prisma.user.findUnique({ where: { username: name } });
}

(async () => {
  try {
    const target = await findUser(username);

    if (!target) {
      const hash = bcrypt.hashSync(password, SALT_ROUNDS);
      const user = await prisma.user.create({
        data: { id: crypto.randomUUID(), username, password: hash, role: 'admin' },
      });
      console.log(
        `Default admin bootstrap: created '${username}' (id ${user.id}). ` +
          'Change the password after first login if this env value lives in plain sight.',
      );
    } else if (target.password === DEMO_HASH) {
      const hash = bcrypt.hashSync(password, SALT_ROUNDS);
      await prisma.user.update({
        where: { id: target.id },
        data: { password: hash, role: 'admin', deletedAt: null },
      });
      console.log(
        `Default admin bootstrap: took over '${username}' from the public demo credentials.`,
      );
    } else {
      console.log(`Default admin bootstrap: '${username}' already configured — leaving it untouched.`);
    }

    if (username !== 'admin') {
      const demo = await findUser('admin');
      if (demo && demo.password === DEMO_HASH && !demo.deletedAt) {
        await prisma.user.update({ where: { id: demo.id }, data: { deletedAt: new Date() } });
        console.log(`Default admin bootstrap: disabled the public 'admin' demo user (custom admin '${username}' is configured).`);
      }
    }
  } catch (e) {
    console.error(`Default admin bootstrap failed: ${e.message}`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
