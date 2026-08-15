// Minimal ambient declaration for `react-native-razorpay`.
// The package ships no type definitions; this covers the promise-based
// checkout API used by SubscriptionCheckoutScreen.

declare module 'react-native-razorpay' {
  interface RazorpayCheckoutOptions {
    key: string;
    subscription_id?: string;
    order_id?: string;
    amount?: string | number;
    currency?: string;
    name?: string;
    description?: string;
    image?: string;
    prefill?: {
      name?: string;
      email?: string;
      contact?: string;
    };
    theme?: { color?: string };
    notes?: Record<string, string>;
    modal?: { backdropcolor?: string; animation?: 'slide' | 'fade' };
  }

  interface RazorpayPaymentSuccessData {
    razorpay_payment_id?: string;
    razorpay_order_id?: string;
    razorpay_subscription_id?: string;
    razorpay_signature?: string;
  }

  interface RazorpayPaymentError {
    code?: string;
    description?: string;
    [key: string]: unknown;
  }

  const RazorpayCheckout: {
    open(
      options: RazorpayCheckoutOptions,
    ): Promise<RazorpayPaymentSuccessData>;
    onExternalWalletSelection?(callback: (data: unknown) => void): void;
  };

  export default RazorpayCheckout;
}
