/**
 * Kinetik Premium pricing — a single global plan.
 *
 * There is exactly ONE premium plan: ₹149/month (INR), for every user
 * regardless of region or phone country code. The old per-country pricing
 * table was removed: dial-code detection misread local numbers stored
 * without a "+" prefix (e.g. an Indian mobile starting with 90 matched
 * Turkey's ₺149.90), so different devices saw different prices.
 */

export interface CurrencyConfig {
  /** ISO 4217 currency code (e.g. "INR") */
  currency: string;
  /** Display symbol (e.g. "₹") */
  symbol: string;
  /** Monthly price in minor units (paise) for the payment gateway */
  amountMinor: number;
  /** Monthly price in major units for display */
  amountMajor: number;
  /** Human-readable label (e.g. "₹149/month") */
  label: string;
}

/** The one and only Kinetik Premium plan. */
export const PREMIUM_PLAN: CurrencyConfig = {
  currency: 'INR',
  symbol: '₹',
  amountMinor: 14900,
  amountMajor: 149,
  label: '₹149/month',
};

/** Single global plan — the phone number no longer affects pricing. */
export function getPricingForPhone(_phone: string): CurrencyConfig {
  return PREMIUM_PLAN;
}

/** Single global plan — the country no longer affects pricing. */
export function getPricingForCountry(_countryCode: string): CurrencyConfig {
  return PREMIUM_PLAN;
}

/** All supported currency codes. */
export function getSupportedCurrencies(): string[] {
  return [PREMIUM_PLAN.currency];
}
