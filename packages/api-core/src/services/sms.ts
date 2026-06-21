import twilio from 'twilio';

// ─── Twilio Configuration ──────────────────────────────
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;
const SMS_DISABLED = process.env.SMS_DISABLED === 'true';

const twilioClient =
  TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && !SMS_DISABLED
    ? twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
    : null;

if (!twilioClient) {
  if (SMS_DISABLED) {
    console.log('[SMS] SMS sending explicitly disabled (SMS_DISABLED=true). OTPs will only be logged.');
  } else {
    console.log('[SMS] Twilio not configured — set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER to send SMS.');
  }
}

// ─── Send OTP via SMS ──────────────────────────────────
export async function sendOtpSms(phone: string, otp: string): Promise<void> {
  if (twilioClient && TWILIO_PHONE_NUMBER) {
    try {
      await twilioClient.messages.create({
        body: `Your Kinetik verification code is: ${otp}. It expires in 5 minutes.`,
        from: TWILIO_PHONE_NUMBER,
        to: phone,
      });
      console.log(`[SMS] OTP sent to ${phone.slice(0, 4)}*** via Twilio`);
    } catch (error: any) {
      console.error(`[SMS] Failed to send OTP to ${phone.slice(0, 4)}***:`, error?.message || error);
      // Fallback: log the OTP so dev can still test
      console.log(`[SMS] FALLBACK — OTP for ${phone.slice(0, 4)}***: ${otp}`);
    }
  } else {
    // Dev mode: just log the OTP
    console.log(`[SMS] DEV MODE — OTP for ${phone.slice(0, 4)}***: ${otp}`);
  }
}
