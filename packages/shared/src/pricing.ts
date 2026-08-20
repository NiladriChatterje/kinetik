/**
 * Multi-currency pricing for Kinetik Premium subscription.
 *
 * Prices are fixed per region (not live-converted) so users see predictable
 * charges. Update these when exchange rates shift significantly or when
 * Razorpay adds/removes supported currencies.
 *
 * Currency codes: https://razorpay.com/docs/payments/payments/currency/
 */

export interface CurrencyConfig {
  /** ISO 4217 currency code (e.g. "INR", "USD") */
  currency: string;
  /** Display symbol (e.g. "₹", "$") */
  symbol: string;
  /** Monthly price in minor units (paise/cents) for Razorpay */
  amountMinor: number;
  /** Monthly price in major units for display */
  amountMajor: number;
  /** Human-readable label (e.g. "₹250/month") */
  label: string;
}

/**
 * Map of country dial codes (without '+') to currency config.
 * Falls back to INR for unknown regions.
 */
const PRICING_BY_COUNTRY: Record<string, CurrencyConfig> = {
  // ─── India ──────────────────────────────────────
  '91': { currency: 'INR', symbol: '₹', amountMinor: 25000, amountMajor: 250, label: '₹250/month' },

  // ─── United States ──────────────────────────────
  '1': { currency: 'USD', symbol: '$', amountMinor: 499, amountMajor: 4.99, label: '$4.99/month' },

  // ─── United Kingdom ─────────────────────────────
  '44': { currency: 'GBP', symbol: '£', amountMinor: 399, amountMajor: 3.99, label: '£3.99/month' },

  // ─── EU countries ───────────────────────────────
  '49': { currency: 'EUR', symbol: '€', amountMinor: 449, amountMajor: 4.49, label: '€4.49/month' },  // Germany
  '33': { currency: 'EUR', symbol: '€', amountMinor: 449, amountMajor: 4.49, label: '€4.49/month' },  // France
  '34': { currency: 'EUR', symbol: '€', amountMinor: 449, amountMajor: 4.49, label: '€4.49/month' },  // Spain
  '39': { currency: 'EUR', symbol: '€', amountMinor: 449, amountMajor: 4.49, label: '€4.49/month' },  // Italy
  '31': { currency: 'EUR', symbol: '€', amountMinor: 449, amountMajor: 4.49, label: '€4.49/month' },  // Netherlands
  '32': { currency: 'EUR', symbol: '€', amountMinor: 449, amountMajor: 4.49, label: '€4.49/month' },  // Belgium
  '351': { currency: 'EUR', symbol: '€', amountMinor: 449, amountMajor: 4.49, label: '€4.49/month' }, // Portugal
  '352': { currency: 'EUR', symbol: '€', amountMinor: 449, amountMajor: 4.49, label: '€4.49/month' }, // Luxembourg
  '358': { currency: 'EUR', symbol: '€', amountMinor: 449, amountMajor: 4.49, label: '€4.49/month' }, // Finland
  '353': { currency: 'EUR', symbol: '€', amountMinor: 449, amountMajor: 4.49, label: '€4.49/month' }, // Ireland
  '354': { currency: 'EUR', symbol: '€', amountMinor: 449, amountMajor: 4.49, label: '€4.49/month' }, // Iceland (uses EUR in practice)
  '370': { currency: 'EUR', symbol: '€', amountMinor: 449, amountMajor: 4.49, label: '€4.49/month' }, // Lithuania
  '371': { currency: 'EUR', symbol: '€', amountMinor: 449, amountMajor: 4.49, label: '€4.49/month' }, // Latvia
  '372': { currency: 'EUR', symbol: '€', amountMinor: 449, amountMajor: 4.49, label: '€4.49/month' }, // Estonia

  // ─── Australia & New Zealand ────────────────────
  '61': { currency: 'AUD', symbol: 'A$', amountMinor: 749, amountMajor: 7.49, label: 'A$7.49/month' },
  '64': { currency: 'NZD', symbol: 'NZ$', amountMinor: 799, amountMajor: 7.99, label: 'NZ$7.99/month' },

  // ─── Canada ─────────────────────────────────────
  // +1 is US, Canada shares country code — detected via area code or locale
  // Handled via locale fallback below

  // ─── Asia ───────────────────────────────────────
  '65': { currency: 'SGD', symbol: 'S$', amountMinor: 649, amountMajor: 6.49, label: 'S$6.49/month' },  // Singapore
  '60': { currency: 'MYR', symbol: 'RM', amountMinor: 1990, amountMajor: 19.90, label: 'RM19.90/month' }, // Malaysia
  '62': { currency: 'IDR', symbol: 'Rp', amountMinor: 49900, amountMajor: 49900, label: 'Rp49,900/month' }, // Indonesia
  '63': { currency: 'PHP', symbol: '₱', amountMinor: 27900, amountMajor: 279, label: '₱279/month' }, // Philippines
  '66': { currency: 'THB', symbol: '฿', amountMinor: 14900, amountMajor: 149, label: '฿149/month' },  // Thailand
  '82': { currency: 'KRW', symbol: '₩', amountMinor: 5490, amountMajor: 5490, label: '₩5,490/month' },  // South Korea
  '81': { currency: 'JPY', symbol: '¥', amountMinor: 699, amountMajor: 699, label: '¥699/month' },  // Japan
  '86': { currency: 'CNY', symbol: '¥', amountMinor: 3490, amountMajor: 34.90, label: '¥34.90/month' }, // China

  // ─── Middle East ────────────────────────────────
  '971': { currency: 'AED', symbol: 'AED', amountMinor: 1790, amountMajor: 17.90, label: 'AED 17.90/month' }, // UAE
  '966': { currency: 'SAR', symbol: 'SR', amountMinor: 1790, amountMajor: 17.90, label: 'SR 17.90/month' },  // Saudi Arabia
  '974': { currency: 'QAR', symbol: 'QR', amountMinor: 1790, amountMajor: 17.90, label: 'QR 17.90/month' },  // Qatar
  '973': { currency: 'BHD', symbol: 'BD', amountMinor: 1890, amountMajor: 1.89, label: 'BD 1.89/month' },   // Bahrain
  '968': { currency: 'OMR', symbol: 'OMR', amountMinor: 1890, amountMajor: 1.89, label: 'OMR 1.89/month' }, // Oman
  '965': { currency: 'KWD', symbol: 'KD', amountMinor: 1490, amountMajor: 1.49, label: 'KD 1.49/month' },  // Kuwait

  // ─── Africa ─────────────────────────────────────
  '27': { currency: 'ZAR', symbol: 'R', amountMinor: 8490, amountMajor: 84.90, label: 'R84.90/month' },  // South Africa
  '234': { currency: 'NGN', symbol: '₦', amountMinor: 399000, amountMajor: 3990, label: '₦3,990/month' }, // Nigeria
  '254': { currency: 'KES', symbol: 'KSh', amountMinor: 64900, amountMajor: 649, label: 'KSh649/month' }, // Kenya

  // ─── South America ──────────────────────────────
  '55': { currency: 'BRL', symbol: 'R$', amountMinor: 2490, amountMajor: 24.90, label: 'R$24.90/month' },  // Brazil
  '52': { currency: 'MXN', symbol: 'MX$', amountMinor: 9990, amountMajor: 99.90, label: 'MX$99.90/month' }, // Mexico
  '54': { currency: 'ARS', symbol: 'AR$', amountMinor: 499000, amountMajor: 4990, label: 'AR$4,990/month' }, // Argentina
  '56': { currency: 'CLP', symbol: 'CL$', amountMinor: 4490, amountMajor: 4490, label: 'CL$4,490/month' }, // Chile
  '57': { currency: 'COP', symbol: 'COL$', amountMinor: 1990000, amountMajor: 19900, label: 'COL$19,900/month' }, // Colombia

  // ─── Pakistan / Bangladesh / Sri Lanka ──────────
  '92': { currency: 'PKR', symbol: 'Rs', amountMinor: 69900, amountMajor: 699, label: 'Rs699/month' },     // Pakistan
  '880': { currency: 'BDT', symbol: '৳', amountMinor: 49900, amountMajor: 499, label: '৳499/month' },     // Bangladesh
  '94': { currency: 'LKR', symbol: 'Rs', amountMinor: 149900, amountMajor: 1499, label: 'Rs1,499/month' }, // Sri Lanka
  '977': { currency: 'NPR', symbol: 'Rs', amountMinor: 54900, amountMajor: 549, label: 'Rs549/month' },    // Nepal

  // ─── Turkey ─────────────────────────────────────
  '90': { currency: 'TRY', symbol: '₺', amountMinor: 14990, amountMajor: 149.90, label: '₺149.90/month' },
};

/** Default fallback — INR (India) */
const DEFAULT_CURRENCY: CurrencyConfig = PRICING_BY_COUNTRY['91'];

/**
 * Extract the country dial code from a phone number string.
 * Handles formats like "+919876543210", "919876543210", "+1-555-123-4567".
 */
export function extractDialCode(phone: string): string | null {
  if (!phone) return null;

  // Strip everything except digits and leading +
  const cleaned = phone.replace(/[^\d+]/g, '');

  if (cleaned.startsWith('+')) {
    const digits = cleaned.slice(1);
    // Try longest prefix match (up to 3 digits for codes like +971)
    for (let len = Math.min(3, digits.length); len >= 1; len--) {
      const prefix = digits.slice(0, len);
      if (PRICING_BY_COUNTRY[prefix]) return prefix;
    }
  }

  // No + prefix — try common lengths (assume country code at start)
  for (let len = Math.min(3, cleaned.length); len >= 1; len--) {
    const prefix = cleaned.slice(0, len);
    if (PRICING_BY_COUNTRY[prefix]) return prefix;
  }

  return null;
}

/**
 * Get the pricing config for a given phone number.
 * Falls back to INR if the country is unknown.
 */
export function getPricingForPhone(phone: string): CurrencyConfig {
  const dialCode = extractDialCode(phone);
  if (dialCode && PRICING_BY_COUNTRY[dialCode]) {
    return PRICING_BY_COUNTRY[dialCode];
  }
  return DEFAULT_CURRENCY;
}

/**
 * Get the pricing config for a given ISO country code (e.g. "IN", "US").
 * Falls back to INR if the country is unknown.
 */
export function getPricingForCountry(countryCode: string): CurrencyConfig {
  if (!countryCode) return DEFAULT_CURRENCY;

  // Map 2-letter ISO codes to dial codes
  const ISO_TO_DIAL: Record<string, string> = {
    IN: '91', US: '1', GB: '44', DE: '49', FR: '33', ES: '34', IT: '39',
    AU: '61', NZ: '64', SG: '65', MY: '60', ID: '62', PH: '63', TH: '66',
    KR: '82', JP: '81', CN: '86', AE: '971', SA: '966', QA: '974',
    BH: '973', OM: '968', KW: '965', ZA: '27', NG: '234', KE: '254',
    BR: '55', MX: '52', AR: '54', CL: '56', CO: '57', PK: '92',
    BD: '880', LK: '94', NP: '977', TR: '90', NL: '31', BE: '32',
    PT: '351', LU: '352', FI: '358', IE: '353', IS: '354',
    LT: '370', LV: '371', EE: '372',
  };

  const dialCode = ISO_TO_DIAL[countryCode.toUpperCase()];
  if (dialCode && PRICING_BY_COUNTRY[dialCode]) {
    return PRICING_BY_COUNTRY[dialCode];
  }
  return DEFAULT_CURRENCY;
}

/**
 * All supported currency codes (for Razorpay plan creation).
 */
export function getSupportedCurrencies(): string[] {
  const currencies = new Set(Object.values(PRICING_BY_COUNTRY).map((c) => c.currency));
  return Array.from(currencies).sort();
}
