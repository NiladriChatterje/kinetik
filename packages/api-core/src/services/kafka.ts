import { Kafka, Producer } from 'kafkajs';
import { KAFKA_TOPICS } from '@kinetik/shared';

let producer: Producer | null = null;

const kafka = new Kafka({
  clientId: 'kinetik-api-core',
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
  retry: {
    initialRetryTime: 300,
    retries: 8,
  },
});

export const kafkaProducer = {
  async connect(): Promise<void> {
    if (!producer) {
      producer = kafka.producer({
        allowAutoTopicCreation: true,
        transactionTimeout: 30000,
      });
      await producer.connect();
      console.log('📨 Kafka producer connected');
    }
  },

  async disconnect(): Promise<void> {
    if (producer) {
      await producer.disconnect();
      producer = null;
      console.log('📨 Kafka producer disconnected');
    }
  },

  async sendEvent(topic: string, event: { type: string; payload: Record<string, unknown> }): Promise<void> {
    if (!producer) {
      await this.connect();
    }
    await producer!.send({
      topic,
      messages: [
        {
          key: event.type,
          value: JSON.stringify({
            ...event,
            timestamp: new Date().toISOString(),
          }),
        },
      ],
    });
  },

  async sendUserEvent(event: { type: string; payload: Record<string, unknown> }): Promise<void> {
    await this.sendEvent(KAFKA_TOPICS.USER_EVENTS, event);
  },

  async sendMatchEvent(event: { type: string; payload: Record<string, unknown> }): Promise<void> {
    await this.sendEvent(KAFKA_TOPICS.MATCH_EVENTS, event);
  },

  async sendPaymentEvent(event: { type: string; payload: Record<string, unknown> }): Promise<void> {
    await this.sendEvent(KAFKA_TOPICS.PAYMENT_EVENTS, event);
  },
};

// Auto-connect on module load
kafkaProducer.connect().catch(console.error);
