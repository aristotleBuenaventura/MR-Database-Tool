import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma.js";
import { ROLES } from "../src/lib/roles.js";

const accounts = [
  {
    email: "admin@mrtool.local",
    password: "Admin123!",
    name: "Admin User",
    role: ROLES.ADMIN,
  },
  {
    email: "viewer@mrtool.local",
    password: "Viewer123!",
    name: "Viewer User",
    role: ROLES.VIEWER,
  },
] as const;

async function main() {
  for (const account of accounts) {
    const passwordHash = await bcrypt.hash(account.password, 10);

    await prisma.user.upsert({
      where: { email: account.email },
      update: {
        passwordHash,
        name: account.name,
        role: account.role,
      },
      create: {
        email: account.email,
        passwordHash,
        name: account.name,
        role: account.role,
      },
    });

    console.log(`Seeded ${account.role}: ${account.email}`);
  }
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
