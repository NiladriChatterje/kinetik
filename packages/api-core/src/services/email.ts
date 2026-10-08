import { BrevoClient, BrevoError } from '@getbrevo/brevo';

// ─── Brevo Configuration ───────────────────────────────
// Transactional email through Brevo's own SDK (REST, not SMTP). The free plan
// allows 300 emails per day and hard-stops at the cap instead of billing, so a
// failed send here means "try again later", never "we owe money".
//
// Up to two Brevo accounts: BREVO_API_KEY is tried first, BREVO_API_KEY_2 takes
// over when it fails (daily cap, bad key, outage). Either one may be missing;
// with neither, codes are only logged. BREVO_SENDER_EMAIL_2 defaults to the
// first sender, but it must be verified in the second account's dashboard too.
//
// Senders must be verified in the Brevo dashboard, on a domain with SPF and
// DKIM records published, or Gmail files the code under spam.
const BREVO_SENDER_NAME = process.env.BREVO_SENDER_NAME || 'Kinetik';
const EMAIL_DISABLED = process.env.EMAIL_DISABLED === 'true';

const OTP_TTL_MINUTES = 5;

// After a cap-style rejection the account is left alone for this long, so the
// rest of the day's logins do not each pay a failed round trip to it first.
const CAP_COOLDOWN_MS = 60 * 60 * 1000;

interface BrevoAccount {
  label: string;
  client: BrevoClient;
  senderEmail: string;
  skipUntil: number;
}

function createAccount(
  label: string,
  apiKey: string | undefined,
  senderEmail: string | undefined,
  keyVar: string,
  senderVar: string,
): BrevoAccount | null {
  if (!apiKey) return null;
  if (!senderEmail) {
    console.warn(`[Email] ${keyVar} is set but ${senderVar} is not; the ${label} Brevo account is unused.`);
    return null;
  }
  try {
    const client = new BrevoClient({
      apiKey,
      // An OTP request must answer quickly; a slow Brevo is treated as a
      // failed send rather than holding the login screen for a minute.
      timeoutInSeconds: 10,
      maxRetries: 1,
    });
    return { label, client, senderEmail, skipUntil: 0 };
  } catch (error: unknown) {
    console.error(`[Email] Could not set up the ${label} Brevo account:`, (error as Error)?.message || error);
    return null;
  }
}

const accounts: BrevoAccount[] = EMAIL_DISABLED
  ? []
  : [
      createAccount('primary', process.env.BREVO_API_KEY, process.env.BREVO_SENDER_EMAIL,
        'BREVO_API_KEY', 'BREVO_SENDER_EMAIL'),
      createAccount('secondary', process.env.BREVO_API_KEY_2,
        process.env.BREVO_SENDER_EMAIL_2 || process.env.BREVO_SENDER_EMAIL,
        'BREVO_API_KEY_2', 'BREVO_SENDER_EMAIL_2'),
    ].filter((a): a is BrevoAccount => a !== null);

if (EMAIL_DISABLED) {
  console.log('[Email] Email sending explicitly disabled (EMAIL_DISABLED=true). OTPs will only be logged.');
} else if (accounts.length === 0) {
  console.log('[Email] Brevo not configured — set BREVO_API_KEY and BREVO_SENDER_EMAIL to send OTP emails.');
} else {
  console.log(`[Email] Brevo accounts ready: ${accounts.map((a) => a.label).join(', ')}`);
}

/** True when a real email is sent for each OTP, false when codes are only logged. */
export function isEmailConfigured(): boolean {
  return accounts.length > 0;
}

/** HTTP statuses Brevo answers with once an account is out of quota or credits. */
function isCapError(statusCode: number | undefined): boolean {
  return statusCode === 429 || statusCode === 402;
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
 * Emails a one-time code, trying each Brevo account in turn. Resolves true
 * when one of them accepted it (or the code was logged, when none is
 * configured) and false when every account rejected or timed out: the caller
 * should tell the user to retry rather than leave them waiting for an email
 * that will never arrive. Never throws.
 */
export async function sendOtpEmail(email: string, otp: string): Promise<boolean> {
  const masked = maskEmail(email);

  if (accounts.length === 0) {
    // Dev mode: just log the OTP
    console.log(`[Email] DEV MODE — OTP for ${masked}: ${otp}`);
    return true;
  }

  const { subject, textContent, htmlContent } = buildOtpEmail(otp);

  // Accounts resting after a cap go last instead of being dropped: the cap may
  // have reset already, and trying them beats failing the login outright.
  const now = Date.now();
  const ordered = [
    ...accounts.filter((a) => a.skipUntil <= now),
    ...accounts.filter((a) => a.skipUntil > now),
  ];

  for (const account of ordered) {
    try {
      const result = await account.client.transactionalEmails.sendTransacEmail({
        sender: { email: account.senderEmail, name: BREVO_SENDER_NAME },
        to: [{ email }],
        subject,
        textContent,
        htmlContent,
        tags: ['otp'],
      });
      account.skipUntil = 0;
      console.log(
        `[Email] OTP sent to ${masked} via Brevo ${account.label} (messageId=${result?.messageId ?? 'n/a'})`,
      );
      return true;
    } catch (error: unknown) {
      if (error instanceof BrevoError) {
        if (isCapError(error.statusCode)) account.skipUntil = Date.now() + CAP_COOLDOWN_MS;
        console.error(
          `[Email] Brevo ${account.label} rejected OTP to ${masked}: HTTP ${error.statusCode} ${error.message}`,
        );
      } else {
        console.error(
          `[Email] Brevo ${account.label} failed to send OTP to ${masked}:`,
          (error as Error)?.message || error,
        );
      }
    }
  }

  console.error(`[Email] Every Brevo account failed for ${masked}; the user is asked to retry.`);
  return false;
}
