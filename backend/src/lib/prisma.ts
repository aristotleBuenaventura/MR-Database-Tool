import "dotenv/config";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../generated/prisma/client.js";

const adapter = new PrismaMariaDb({
  host: process.env.DATABASE_HOST ?? "localhost",
  port: Number(process.env.DATABASE_PORT ?? 3306),
  user: process.env.DATABASE_USER ?? "root",
  password: process.env.DATABASE_PASSWORD ?? "",
  database: process.env.DATABASE_NAME ?? "mr_database_tool",
  connectionLimit: 5,
  // Required for MySQL 8 caching_sha2_password on many cloud/VPS setups.
  allowPublicKeyRetrieval: true,
});

export const prisma = new PrismaClient({ adapter });
