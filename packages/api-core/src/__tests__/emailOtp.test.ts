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
class MockBrevoClient {
  transactionalEmails = { sendTransacEmail: mockSendTransacEmail };
}

vi.mock('@getbrevo/brevo', () => ({
  BrevoClient: MockBrevoClient,
  BrevoError: MockBrevoError,
}));

const ORIGINAL_ENV = { ...process.env };

/** (Re)load the service with the given env so its module-level config is rebuilt. */
async function loadEmailService(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const key of ['BREVO_API_KEY', 'BREVO_SENDER_EMAIL', 'BREVO_SENDER_NAME', 'EMAIL_DISABLED']) {
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

  describe('maskEmail', () => {
    it('keeps at most two leading characters and the domain', async () => {
      const { maskEmail } = await loadEmailService({});
      expect(maskEmail('alice@example.com')).toBe('al***@example.com');
      expect(maskEmail('a@example.com')).toBe('a***@example.com');
      expect(maskEmail('not-an-email')).toBe('***');
    });
  });
});
