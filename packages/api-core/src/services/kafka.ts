/**
 * @deprecated Kafka has been replaced by Redis event bus.
 * Import from './eventBus' instead.
 *
 * This file remains as a compatibility shim for any remaining references.
 * It delegates all calls to the new eventBus service.
 */

import { eventBus } from './eventBus';
import { EVENT_BUS_CHANNELS } from '@kinetik/shared';

export const kafkaProducer = {
  async connect(): Promise<void> {
    console.warn('[Deprecated] kafkaProducer is deprecated — use eventBus instead');
    await eventBus.connect();
  },

  async disconnect(): Promise<void> {
    await eventBus.disconnect();
  },

  async sendEvent(topic: string, event: { type: string; payload: Record<string, unknown> }): Promise<void> {
    // Map old Kafka topic names to new event bus channels
    const channelMap: Record<string, string> = {
      'kinetik.user.events': EVENT_BUS_CHANNELS.USER_EVENTS,
      'kinetik.match.events': EVENT_BUS_CHANNELS.MATCH_EVENTS,
      'kinetik.vibe.events': EVENT_BUS_CHANNELS.VIBE_EVENTS,
      'kinetik.window.events': EVENT_BUS_CHANNELS.WINDOW_EVENTS,
      'kinetik.payment.events': EVENT_BUS_CHANNELS.PAYMENT_EVENTS,
    };
    const channel = channelMap[topic] || topic;
    await eventBus.publish(channel, event);
  },

  async sendUserEvent(event: { type: string; payload: Record<string, unknown> }): Promise<void> {
    await eventBus.sendUserEvent(event);
  },

  async sendMatchEvent(event: { type: string; payload: Record<string, unknown> }): Promise<void> {
    await eventBus.sendMatchEvent(event);
  },

  async sendPaymentEvent(event: { type: string; payload: Record<string, unknown> }): Promise<void> {
    await eventBus.sendPaymentEvent(event);
  },
};

// Auto-connect on module load (handled by eventBus now)
