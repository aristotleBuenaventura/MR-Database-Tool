import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma.js";
import { ROLES } from "../src/lib/roles.js";

const SUPERADMIN = {
  email: "aris@casinomcw.com",
  password: "Yamqhou23!$",
  name: "Aris",
  role: ROLES.SUPERADMIN,
} as const;

async function main() {
  const passwordHash = await bcrypt.hash(SUPERADMIN.password, 10);

  // Wipe all accounts, then create the sole superadmin.
  await prisma.passwordResetToken.deleteMany();
  await prisma.userSession.deleteMany();
  await prisma.user.deleteMany();

  await prisma.user.create({
    data: {
      email: SUPERADMIN.email,
      passwordHash,
      name: SUPERADMIN.name,
      role: SUPERADMIN.role,
      totpEnabled: false,
      totpSecret: null,
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
  });

  console.log(`Reset users. Superadmin: ${SUPERADMIN.email}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
