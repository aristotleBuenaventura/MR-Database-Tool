import fs from "node:fs";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../generated/prisma/client.js";

dotenv.config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.env"),
});

const host = process.env.DATABASE_HOST ?? "localhost";
const isLocalHost = host === "localhost" || host === "127.0.0.1";
const dbUser = process.env.DATABASE_USER ?? "root";
const dbName = process.env.DATABASE_NAME ?? "mr_database_tool";

const COMMON_SOCKETS = [
  "/tmp/mysql.sock", // macOS / Homebrew MySQL
  "/tmp/mysqlx.sock",
  "/opt/homebrew/var/mysql/mysql.sock",
  "/usr/local/var/mysql/mysql.sock",
  "/var/run/mysqld/mysqld.sock", // Linux
  "/run/mysqld/mysqld.sock",
];

function resolveSocketPath(): string | undefined {
  if (process.env.DATABASE_SOCKET) {
    return process.env.DATABASE_SOCKET;
  }
  return COMMON_SOCKETS.find((candidate) => {
    try {
      return fs.existsSync(candidate);
    } catch {
      return false;
    }
  });
}

/**
 * Prefer a real Unix socket on localhost (avoids MySQL 8
 * caching_sha2_password / "RSA public key is not available" over TCP).
 * Fall back to TCP if no socket file is present.
 */
const socketPath = isLocalHost ? resolveSocketPath() : undefined;

const adapter = new PrismaMariaDb({
  ...(socketPath
    ? { socketPath }
    : {
        host,
        port: Number(process.env.DATABASE_PORT ?? 3306),
      }),
  user: dbUser,
  password: process.env.DATABASE_PASSWORD ?? "",
  database: dbName,
  connectionLimit: 5,
  allowPublicKeyRetrieval: true,
  ssl: false,
  connectTimeout: 10_000,
});

export const prisma = new PrismaClient({ adapter });

export function getDbConfigSummary() {
  return {
    host: socketPath ? `unix-socket:${socketPath}` : host,
    user: dbUser,
    database: dbName,
    passwordSet: Boolean(process.env.DATABASE_PASSWORD),
  };
}
