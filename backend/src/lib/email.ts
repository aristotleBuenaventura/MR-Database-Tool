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
    // Prevent forgot-password from hanging forever on bad SMTP.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
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
    console.warn("[email] SMTP not configured. Password reset email was not sent.");
    return { sent: false, logged: false };
  }

  const started = Date.now();
  try {
    await transport.sendMail({
      from,
      to: options.to,
      subject,
      text,
      html,
    });
    console.info(`[email] sent in ${Date.now() - started}ms to=${options.to}`);
    return { sent: true, logged: false };
  } catch (error) {
    console.error(
      `[email] send failed after ${Date.now() - started}ms`,
      error instanceof Error ? error.message : "send error",
    );
    return { sent: false, logged: false };
  }
}
