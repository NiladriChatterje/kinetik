// Minimal ambient declarations for the `razorpay` npm package.
// The SDK ships no type definitions; these cover only the APIs used by
// services/razorpay.ts and routes/webhooks.ts.

declare module 'razorpay' {
  export interface RazorpayPlan {
    id: string;
    period: string;
    interval: number;
    item: { name: string; amount: number; currency: string };
    notes?: Record<string, unknown>;
  }

  export interface RazorpaySubscription {
    id: string;
    status: string;
    plan_id: string;
    total_count: number;
    paid_count: number;
    customer_notify: number;
    current_end?: number;
    notes?: Record<string, string>;
  }

  export interface RazorpaySubscriptionCreateParams {
    plan_id: string;
    total_count: number;
    customer_notify?: number;
    notes?: Record<string, string>;
  }

  class Razorpay {
    constructor(options: { key_id: string; key_secret: string });
    plans: {
      create(params: {
        period: string;
        interval: number;
        item: { name: string; description?: string; amount: number; currency: string };
        notes?: Record<string, string>;
      }): Promise<RazorpayPlan>;
    };
    subscriptions: {
      create(params: RazorpaySubscriptionCreateParams): Promise<RazorpaySubscription>;
      fetch(subscriptionId: string): Promise<RazorpaySubscription>;
      cancel(
        subscriptionId: string,
        cancelAtCycleEnd?: boolean,
      ): Promise<RazorpaySubscription>;
    };
  }

  export default Razorpay;
}

declare module 'razorpay/dist/utils/razorpay-utils' {
  export function validateWebhookSignature(
    body: string | Buffer,
    signature: string,
    secret: string,
  ): boolean;
}
