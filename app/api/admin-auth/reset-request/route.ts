import { getAdminPasswordResetOtp, isAdminConfigured, issueAdminPasswordReset } from "../../../../lib/admin-auth";

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const sendResetEmail = async (email: string, resetUrl: string, otp: string) => {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.ADMIN_RESET_FROM_EMAIL?.trim() || process.env.MAIL_FROM?.trim();
  if (!apiKey || !from) return { configured: false, sent: false };

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from,
        to: [email],
        subject: "Reset your Fanzzy admin password",
        text: `Reset your Fanzzy admin password: ${resetUrl}\n\nYour one-time verification code is ${otp}. It expires in 15 minutes and can only be used once.`,
        html: `<p>We received a request to reset your Fanzzy admin password.</p><p><a href="${resetUrl}">Reset password</a></p><p>Or enter this one-time verification code: <strong>${otp}</strong></p><p>This link and code expire in 15 minutes and can only be used once.</p>`,
      }),
    });
    return { configured: true, sent: response.ok };
  } catch {
    return { configured: true, sent: false };
  }
};

export async function POST(request: Request) {
  if (!isAdminConfigured()) return json({ error: "Admin login is not configured." }, 503);

  let body: { email?: unknown };
  try {
    body = await request.json() as { email?: unknown };
  } catch {
    return json({ error: "Enter your admin email address." }, 400);
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!email) return json({ error: "Enter your admin email address." }, 400);

  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.ADMIN_RESET_FROM_EMAIL?.trim() || process.env.MAIL_FROM?.trim();
  if (!apiKey || !from) {
    return json({ error: "Email delivery is not configured. Reset codes and links are not shown on this website." }, 503);
  }

  const token = issueAdminPasswordReset(email);
  if (!token) return json({ message: "If that email is configured, a password reset email will be sent." });

  const resetUrl = `${new URL(request.url).origin}/admin?admin-reset=${encodeURIComponent(token)}`;
  const otp = getAdminPasswordResetOtp(token);
  const delivery = await sendResetEmail(email, resetUrl, otp || "");
  if (delivery.sent) return json({ message: "Password reset email sent. Check your inbox and spam folder.", resetReady: true });
  if (delivery.configured) return json({ error: "The email provider could not send the reset email. Try again." }, 502);
  return json({ error: "Email delivery is not configured." }, 503);
}
