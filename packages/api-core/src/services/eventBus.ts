/**
 * Event Bus — Drop-in replacement for Kafka using a dedicated Redis instance.
 *
 * This service publishes events to Redis Pub/Sub channels using a SEPARATE
 * Redis connection (REDIS_EVENTS_HOST) from the one used for caching and
 * Socket.IO adapters. This prevents event storms from impacting latency-
 * sensitive operations.
 *
 * Usage (same API as the old kafkaProducer):
 *   import { eventBus } from '../services/eventBus';
 *   await eventBus.sendMatchEvent({ type: 'match.created', payload: { ... } });
 */

import Redis from 'ioredis';
import { EVENT_BUS_CHANNELS } from '@kinetik/shared';

let publisher: Redis | null = null;

function getPublisher(): Redis {
  if (!publisher) {
    publisher = new Redis({
      host: process.env.REDIS_EVENTS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_EVENTS_PORT || '6380', 10),
      password: process.env.REDIS_EVENTS_PASSWORD,
      retryStrategy: (times) => Math.min(times * 50, 2000),
      maxRetriesPerRequest: 3,
      enableOfflineQueue: false,
      lazyConnect: true,
    });

    publisher.on('connect', () => {
      console.log('📡 Event Bus Redis connected');
    });

    publisher.on('error', (err) => {
      console.error('Event Bus Redis error:', err.message);
    });
  }
  return publisher;
}

export const eventBus = {
  async connect(): Promise<void> {
    if (!publisher) {
      getPublisher();
    }
    if (publisher && publisher.status !== 'ready') {
      await publisher.connect();
      console.log('📨 Event Bus connected');
    }
  },

  async disconnect(): Promise<void> {
    if (publisher) {
      await publisher.quit();
      publisher = null;
      console.log('📨 Event Bus disconnected');
    }
  },

  /**
   * Publish an event to a specific channel.
   */
  async publish(
    channel: string,
    event: { type: string; payload: Record<string, unknown> },
  ): Promise<void> {
    if (!publisher) {
      getPublisher();
    }
    if (publisher!.status !== 'ready') {
      await publisher!.connect();
    }

    const message = JSON.stringify({
      ...event,
      timestamp: new Date().toISOString(),
    });

    await publisher!.publish(channel, message);
  },

  /**
   * Publish a match-related event.
   */
  async sendMatchEvent(event: { type: string; payload: Record<string, unknown> }): Promise<void> {
    await this.publish(EVENT_BUS_CHANNELS.MATCH_EVENTS, event);
  },

  /**
   * Publish a user-related event.
   */
  async sendUserEvent(event: { type: string; payload: Record<string, unknown> }): Promise<void> {
    await this.publish(EVENT_BUS_CHANNELS.USER_EVENTS, event);
  },

  /**
   * Publish a payment-related event.
   */
  async sendPaymentEvent(event: { type: string; payload: Record<string, unknown> }): Promise<void> {
    await this.publish(EVENT_BUS_CHANNELS.PAYMENT_EVENTS, event);
  },

  /**
   * Publish a window-related event.
   */
  async sendWindowEvent(event: { type: string; payload: Record<string, unknown> }): Promise<void> {
    await this.publish(EVENT_BUS_CHANNELS.WINDOW_EVENTS, event);
  },

  /**
   * Publish a vibe check event.
   */
  async sendVibeEvent(event: { type: string; payload: Record<string, unknown> }): Promise<void> {
    await this.publish(EVENT_BUS_CHANNELS.VIBE_EVENTS, event);
  },
};
