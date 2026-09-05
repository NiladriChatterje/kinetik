import { BrevoClient, BrevoError } from '@getbrevo/brevo';

// ─── Brevo Configuration ───────────────────────────────
// Transactional email through Brevo's own SDK (REST, not SMTP). The free plan
// allows 300 emails per day and hard-stops at the cap instead of billing, so a
// failed send here means "try again later", never "we owe money".
//
// BREVO_SENDER_EMAIL must be a sender verified in the Brevo dashboard, on a
// domain with SPF and DKIM records published, or Gmail files the code under spam.
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const BREVO_SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL;
const BREVO_SENDER_NAME = process.env.BREVO_SENDER_NAME || 'Kinetik';
const EMAIL_DISABLED = process.env.EMAIL_DISABLED === 'true';

const OTP_TTL_MINUTES = 5;

const brevoClient =
  BREVO_API_KEY && BREVO_SENDER_EMAIL && !EMAIL_DISABLED
    ? new BrevoClient({
        apiKey: BREVO_API_KEY,
        // An OTP request must answer quickly; a slow Brevo is treated as a
        // failed send rather than holding the login screen for a minute.
        timeoutInSeconds: 10,
        maxRetries: 1,
      })
    : null;

if (!brevoClient) {
  if (EMAIL_DISABLED) {
    console.log('[Email] Email sending explicitly disabled (EMAIL_DISABLED=true). OTPs will only be logged.');
  } else {
    console.log('[Email] Brevo not configured — set BREVO_API_KEY and BREVO_SENDER_EMAIL to send OTP emails.');
  }
}

/** True when a real email is sent for each OTP, false when codes are only logged. */
export function isEmailConfigured(): boolean {
  return brevoClient !== null;
}

/** "someone@example.com" → "so***@example.com". Safe for logs and API responses. */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at);
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}***${domain}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildOtpEmail(otp: string): { subject: string; textContent: string; htmlContent: string } {
  const code = escapeHtml(otp);
  const subject = `${code} is your Kinetik verification code`;
  const textContent =
    `Your Kinetik verification code is ${otp}.\n\n` +
    `It expires in ${OTP_TTL_MINUTES} minutes. If you did not request this code, you can ignore this email.`;
  const htmlContent =
    `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;padding:24px">` +
    `<p style="margin:0 0 16px">Your Kinetik verification code is</p>` +
    `<p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:0 0 16px">${code}</p>` +
    `<p style="margin:0 0 8px;color:#555">It expires in ${OTP_TTL_MINUTES} minutes.</p>` +
    `<p style="margin:0;color:#555">If you did not request this code, you can ignore this email.</p>` +
    `</body></html>`;
  return { subject, textContent, htmlContent };
}

// ─── Send OTP via Email ────────────────────────────────
/**
 * Emails a one-time code. Resolves true when the code was accepted by Brevo
 * (or logged, when no provider is configured) and false when Brevo rejected
 * or timed out — the caller should tell the user to retry rather than leave
 * them waiting for an email that will never arrive.
 */
export async function sendOtpEmail(email: string, otp: string): Promise<boolean> {
  const masked = maskEmail(email);

  if (!brevoClient || !BREVO_SENDER_EMAIL) {
    // Dev mode: just log the OTP
    console.log(`[Email] DEV MODE — OTP for ${masked}: ${otp}`);
    return true;
  }

  const { subject, textContent, htmlContent } = buildOtpEmail(otp);

  try {
    const result = await brevoClient.transactionalEmails.sendTransacEmail({
      sender: { email: BREVO_SENDER_EMAIL, name: BREVO_SENDER_NAME },
      to: [{ email }],
      subject,
      textContent,
      htmlContent,
      tags: ['otp'],
    });
    console.log(`[Email] OTP sent to ${masked} via Brevo (messageId=${result?.messageId ?? 'n/a'})`);
    return true;
  } catch (error: unknown) {
    if (error instanceof BrevoError) {
      // 429 / 402-style responses are what the free plan returns at the daily cap.
      console.error(`[Email] Brevo rejected OTP to ${masked}: HTTP ${error.statusCode} ${error.message}`);
    } else {
      console.error(`[Email] Failed to send OTP to ${masked}:`, (error as Error)?.message || error);
    }
    return false;
  }
}
