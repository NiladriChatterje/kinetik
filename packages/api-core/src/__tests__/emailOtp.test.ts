import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────
// The Brevo SDK is mocked at the module boundary so the tests exercise our
// wrapper (config gating, payload shape, failure handling) without network.

const mockSendTransacEmail = vi.fn();

class MockBrevoError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

// A real class: the service calls `new BrevoClient(...)`, and Vitest 4 rejects
// arrow-function mock implementations invoked with `new`.
// The second argument says which account sent it, for the failover tests.
class MockBrevoClient {
  transactionalEmails: { sendTransacEmail: (payload: unknown) => unknown };
  constructor(opts: { apiKey: string }) {
    this.transactionalEmails = {
      sendTransacEmail: (payload: unknown) => mockSendTransacEmail(payload, opts.apiKey),
    };
  }
}

vi.mock('@getbrevo/brevo', () => ({
  BrevoClient: MockBrevoClient,
  BrevoError: MockBrevoError,
}));

const ORIGINAL_ENV = { ...process.env };

/** (Re)load the service with the given env so its module-level config is rebuilt. */
async function loadEmailService(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const key of [
    'BREVO_API_KEY', 'BREVO_SENDER_EMAIL', 'BREVO_SENDER_NAME', 'EMAIL_DISABLED',
    'BREVO_API_KEY_2', 'BREVO_SENDER_EMAIL_2',
  ]) {
    delete process.env[key];
  }
  Object.assign(process.env, env);
  return import('../services/email');
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('services/email — Brevo OTP delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  describe('when Brevo is not configured', () => {
    it('reports unconfigured and only logs the code', async () => {
      const email = await loadEmailService({});

      expect(email.isEmailConfigured()).toBe(false);
      const sent = await email.sendOtpEmail('alice@example.com', '482913');

      expect(sent).toBe(true);
      expect(mockSendTransacEmail).not.toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('DEV MODE'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('482913'));
    });

    it('treats EMAIL_DISABLED=true as unconfigured even with a key present', async () => {
      const email = await loadEmailService({
        BREVO_API_KEY: 'xkeysib-test',
        BREVO_SENDER_EMAIL: 'login@kinetik.test',
        EMAIL_DISABLED: 'true',
      });

      expect(email.isEmailConfigured()).toBe(false);
      await email.sendOtpEmail('alice@example.com', '000000');
      expect(mockSendTransacEmail).not.toHaveBeenCalled();
    });

    it('requires both the API key and a sender address', async () => {
      const email = await loadEmailService({ BREVO_API_KEY: 'xkeysib-test' });
      expect(email.isEmailConfigured()).toBe(false);
    });
  });

  describe('when Brevo is configured', () => {
    const env = {
      BREVO_API_KEY: 'xkeysib-test',
      BREVO_SENDER_EMAIL: 'login@kinetik.test',
      BREVO_SENDER_NAME: 'Kinetik Login',
    };

    it('sends through the SDK with the sender, recipient and code', async () => {
      mockSendTransacEmail.mockResolvedValueOnce({ messageId: '<msg-1@brevo>' });
      const email = await loadEmailService(env);

      expect(email.isEmailConfigured()).toBe(true);
      const sent = await email.sendOtpEmail('alice@example.com', '482913');

      expect(sent).toBe(true);
      expect(mockSendTransacEmail).toHaveBeenCalledTimes(1);
      const payload = mockSendTransacEmail.mock.calls[0][0];
      expect(payload.sender).toEqual({ email: 'login@kinetik.test', name: 'Kinetik Login' });
      expect(payload.to).toEqual([{ email: 'alice@example.com' }]);
      expect(payload.subject).toContain('482913');
      expect(payload.textContent).toContain('482913');
      expect(payload.htmlContent).toContain('482913');
      expect(payload.tags).toEqual(['otp']);
    });

    it('never puts the full recipient address in the log line', async () => {
      mockSendTransacEmail.mockResolvedValueOnce({ messageId: 'x' });
      const email = await loadEmailService(env);

      await email.sendOtpEmail('alice@example.com', '482913');

      const logged = (console.log as any).mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
      expect(logged).not.toContain('alice@example.com');
      expect(logged).toContain('al***@example.com');
    });

    it('returns false when Brevo rejects the send (e.g. daily cap reached)', async () => {
      mockSendTransacEmail.mockRejectedValueOnce(new MockBrevoError(429, 'Daily limit reached'));
      const email = await loadEmailService(env);

      const sent = await email.sendOtpEmail('alice@example.com', '482913');

      expect(sent).toBe(false);
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('HTTP 429'));
    });

    it('returns false on a network-level failure', async () => {
      mockSendTransacEmail.mockRejectedValueOnce(new Error('ECONNRESET'));
      const email = await loadEmailService(env);

      const sent = await email.sendOtpEmail('alice@example.com', '482913');
      expect(sent).toBe(false);
    });
  });

  describe('with two Brevo accounts', () => {
    const env = {
      BREVO_API_KEY: 'key-one',
      BREVO_SENDER_EMAIL: 'login@kinetik.test',
      BREVO_API_KEY_2: 'key-two',
    };
    const keysUsed = () => mockSendTransacEmail.mock.calls.map((c) => c[1]);

    it('uses only the first account while it works', async () => {
      mockSendTransacEmail.mockResolvedValue({ messageId: 'x' });
      const email = await loadEmailService(env);

      expect(await email.sendOtpEmail('alice@example.com', '111111')).toBe(true);
      expect(keysUsed()).toEqual(['key-one']);
    });

    it('fails over to the second account, reusing the first sender by default', async () => {
      mockSendTransacEmail
        .mockRejectedValueOnce(new MockBrevoError(429, 'Daily limit reached'))
        .mockResolvedValueOnce({ messageId: 'x' });
      const email = await loadEmailService(env);

      expect(await email.sendOtpEmail('alice@example.com', '111111')).toBe(true);
      expect(keysUsed()).toEqual(['key-one', 'key-two']);
      expect(mockSendTransacEmail.mock.calls[1][0].sender.email).toBe('login@kinetik.test');
    });

    it('also fails over on a network error', async () => {
      mockSendTransacEmail
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockResolvedValueOnce({ messageId: 'x' });
      const email = await loadEmailService(env);

      expect(await email.sendOtpEmail('alice@example.com', '111111')).toBe(true);
      expect(keysUsed()).toEqual(['key-one', 'key-two']);
    });

    it('returns false and logs when both accounts fail', async () => {
      mockSendTransacEmail.mockRejectedValue(new MockBrevoError(429, 'Daily limit reached'));
      const email = await loadEmailService(env);

      expect(await email.sendOtpEmail('alice@example.com', '111111')).toBe(false);
      expect(keysUsed()).toEqual(['key-one', 'key-two']);
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Every Brevo account failed'));
    });

    it('tries the capped account last for the next send', async () => {
      mockSendTransacEmail
        .mockRejectedValueOnce(new MockBrevoError(429, 'Daily limit reached'))
        .mockResolvedValue({ messageId: 'x' });
      const email = await loadEmailService(env);

      await email.sendOtpEmail('alice@example.com', '111111');
      await email.sendOtpEmail('bob@example.com', '222222');
      expect(keysUsed()).toEqual(['key-one', 'key-two', 'key-two']);
    });

    it('uses its own sender when BREVO_SENDER_EMAIL_2 is set', async () => {
      mockSendTransacEmail
        .mockRejectedValueOnce(new Error('down'))
        .mockResolvedValueOnce({ messageId: 'x' });
      const email = await loadEmailService({ ...env, BREVO_SENDER_EMAIL_2: 'otp@kinetik.test' });

      await email.sendOtpEmail('alice@example.com', '111111');
      expect(mockSendTransacEmail.mock.calls[1][0].sender.email).toBe('otp@kinetik.test');
    });

    it('works with only the second account configured', async () => {
      mockSendTransacEmail.mockResolvedValue({ messageId: 'x' });
      const email = await loadEmailService({
        BREVO_API_KEY_2: 'key-two',
        BREVO_SENDER_EMAIL_2: 'otp@kinetik.test',
      });

      expect(email.isEmailConfigured()).toBe(true);
      expect(await email.sendOtpEmail('alice@example.com', '111111')).toBe(true);
      expect(keysUsed()).toEqual(['key-two']);
    });

    it('skips a key with no sender at all and warns about it', async () => {
      const email = await loadEmailService({ BREVO_API_KEY_2: 'key-two' });

      expect(email.isEmailConfigured()).toBe(false);
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('BREVO_SENDER_EMAIL_2'));
    });
  });

  describe('maskEmail', () => {
    it('keeps at most two leading characters and the domain', async () => {
      const { maskEmail } = await loadEmailService({});
      expect(maskEmail('alice@example.com')).toBe('al***@example.com');
      expect(maskEmail('a@example.com')).toBe('a***@example.com');
      expect(maskEmail('not-an-email')).toBe('***');
    });
  });
});
