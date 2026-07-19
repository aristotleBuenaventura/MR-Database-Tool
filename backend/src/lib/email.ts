import nodemailer from "nodemailer";

function createTransport() {
  const host = process.env.SMTP_HOST?.trim();
  if (!host) return null;

  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: user && pass ? { user, pass } : undefined,
  });
}

export async function sendPasswordResetEmail(options: {
  to: string;
  resetUrl: string;
}): Promise<{ sent: boolean; logged: boolean }> {
  const from =
    process.env.SMTP_FROM?.trim() ||
    "MR Database Tool <noreply@localhost>";
  const subject = "Reset your MR Database Tool password";
  const text = [
    "You requested a password reset for your MR Database Tool account.",
    "",
    "Open this link to set a new password (expires in 1 hour):",
    options.resetUrl,
    "",
    "If you did not request this, you can ignore this email.",
  ].join("\n");
  const html = `
    <p>You requested a password reset for your <strong>MR Database Tool</strong> account.</p>
    <p><a href="${options.resetUrl}">Set a new password</a></p>
    <p>This link expires in <strong>1 hour</strong>.</p>
    <p>If you did not request this, you can ignore this email.</p>
  `.trim();

  const transport = createTransport();
  if (!transport) {
    console.warn(
      "[email] SMTP not configured. Password reset link (dev):\n",
      options.resetUrl,
    );
    return { sent: false, logged: true };
  }

  await transport.sendMail({
    from,
    to: options.to,
    subject,
    text,
    html,
  });

  return { sent: true, logged: false };
}
