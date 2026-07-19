import { generateSecret, generateURI, verifySync } from "otplib";
import { rolesRequiring2fa } from "./securityConfig.js";

export function requires2faRole(role: string): boolean {
  return rolesRequiring2fa().has(role.toLowerCase());
}

export function generateTotpSecret(): string {
  return generateSecret();
}

export function buildOtpauthUrl(email: string, secret: string): string {
  const issuer = process.env.TOTP_ISSUER ?? "MR Database Tool";
  return generateURI({
    issuer,
    label: email,
    secret,
  });
}

export function verifyTotpCode(secret: string, token: string): boolean {
  try {
    const result = verifySync({
      secret,
      token: token.replace(/\s/g, ""),
    });
    return Boolean(result.valid);
  } catch {
    return false;
  }
}
