import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { prisma } from "./prisma.js";

const PREFIX = "enc:v1:";

let cachedKey: Buffer | null = null;

function encryptionKey(): Buffer {
  if (cachedKey) return cachedKey;
  const secret = process.env.JWT_SECRET ?? "";
  if (secret.length < 16) {
    throw new Error("JWT_SECRET is not configured");
  }
  cachedKey = scryptSync(secret, "mr-totp-secret-v1", 32);
  return cachedKey;
}

export function isSealedTotpSecret(value: string): boolean {
  return value.startsWith(PREFIX);
}

/** Encrypt an authenticator secret before it is stored. */
export function sealTotpSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plain, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

/** Decrypt a stored secret. Older rows that are still plain text pass through. */
export function openTotpSecret(stored: string): string {
  if (!isSealedTotpSecret(stored)) return stored;
  const body = stored.slice(PREFIX.length);
  const [ivPart, tagPart, dataPart] = body.split(".");
  if (!ivPart || !tagPart || !dataPart) {
    throw new Error("Invalid authenticator secret");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivPart, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(dataPart, "base64url")),
    decipher.final(),
  ]);
  return plain.toString("utf8");
}

/** Rewrite any still-plain authenticator secrets so a database copy is not enough. */
export async function sealExistingTotpSecrets(): Promise<number> {
  const users = await prisma.user.findMany({
    where: { totpSecret: { not: null } },
    select: { id: true, totpSecret: true },
  });
  let sealed = 0;
  for (const user of users) {
    if (!user.totpSecret || isSealedTotpSecret(user.totpSecret)) continue;
    await prisma.user.update({
      where: { id: user.id },
      data: { totpSecret: sealTotpSecret(user.totpSecret) },
    });
    sealed += 1;
  }
  return sealed;
}
