import { describe, it, expect } from 'vitest';
import { toSubscriptionChanged } from '../handlers/subscription';

// The payment events api-core publishes (services/subscriptionEntitlement.ts),
// as they arrive over Redis after JSON round-tripping.

describe('toSubscriptionChanged', () => {
  it('maps an activation to premium, with expiry and Play state', () => {
    const event = {
      type: 'subscription.activated',
      payload: {
        userId: 'u1',
        tier: 'premium',
        expiresAt: '2026-10-27T13:00:00.000Z',
        state: 'SUBSCRIPTION_STATE_ACTIVE',
      },
      timestamp: '2026-10-20T13:00:00.000Z',
    };
    expect(toSubscriptionChanged(event)).toEqual({
      userId: 'u1',
      payload: {
        premium: true,
        expiresAt: '2026-10-27T13:00:00.000Z',
        state: 'SUBSCRIPTION_STATE_ACTIVE',
      },
    });
  });

  it('maps a cancellation (expiry, refund, hold) to not premium', () => {
    const event = {
      type: 'subscription.cancelled',
      payload: { userId: 'u1', tier: 'free', expiresAt: null, state: 'SUBSCRIPTION_STATE_ON_HOLD' },
    };
    expect(toSubscriptionChanged(event)).toEqual({
      userId: 'u1',
      payload: { premium: false, expiresAt: null, state: 'SUBSCRIPTION_STATE_ON_HOLD' },
    });
  });

  it('ignores other events and malformed ones', () => {
    expect(toSubscriptionChanged({ type: 'like.created', payload: { userId: 'u1' } })).toBeNull();
    expect(toSubscriptionChanged({ type: 'subscription.activated', payload: {} })).toBeNull();
    expect(toSubscriptionChanged({ type: 'subscription.activated' })).toBeNull();
    expect(toSubscriptionChanged(null)).toBeNull();
    expect(toSubscriptionChanged('subscription.activated')).toBeNull();
  });

  it('never passes through non-string expiry or state', () => {
    const event = {
      type: 'subscription.activated',
      payload: { userId: 'u1', expiresAt: 12345, state: { nested: true } },
    };
    expect(toSubscriptionChanged(event)?.payload).toEqual({
      premium: true,
      expiresAt: null,
      state: null,
    });
  });
});
