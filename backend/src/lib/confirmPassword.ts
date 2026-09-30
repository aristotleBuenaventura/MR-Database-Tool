import bcrypt from "bcryptjs";
import { prisma } from "./prisma.js";

/** Returns an HTTP error when the signed-in user's password does not match. */
export async function rejectIfPasswordWrong(
  userId: number | undefined,
  password: unknown,
): Promise<{ status: number; error: string } | null> {
  const value = String(password ?? "");
  if (!value) {
    return { status: 400, error: "Password is required" };
  }
  if (!userId) {
    return { status: 401, error: "Unauthorized" };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });
  if (!user) {
    return { status: 401, error: "Unauthorized" };
  }

  const matches = await bcrypt.compare(value, user.passwordHash);
  if (!matches) {
    return { status: 401, error: "Incorrect password" };
  }

  return null;
}
