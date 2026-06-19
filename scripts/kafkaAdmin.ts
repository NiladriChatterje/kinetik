/**
 * Kinetik - Kafka Topic Admin Script
 *
 * Creates/updates the required Kafka topics for the Kinetik platform.
 * Run: npx tsx scripts/kafkaAdmin.ts
 *
 * Environment variables:
 *   KAFKA_BROKERS  - Comma-separated broker list (default: localhost:9092)
 *   KAFKA_CLIENT_ID - Admin client ID (default: kinetik-admin)
 */

import { Kafka, Admin, ITopicConfig } from 'kafkajs';

// ─── Topic Definitions ────────────────────────────────────
// These mirror the KAFKA_TOPICS constant in packages/shared/src/constants

interface TopicDefinition extends ITopicConfig {
  description: string;
}

const TOPICS: TopicDefinition[] = [
  {
    topic: 'kinetik.user.events',
    numPartitions: 3,
    replicationFactor: 1,
    description: 'User lifecycle events: registration, profile updates, preferences, location changes',
    configEntries: [
      { name: 'retention.ms', value: '604800000' },       // 7 days
      { name: 'cleanup.policy', value: 'delete' },
      { name: 'compression.type', value: 'producer' },
    ],
  },
  {
    topic: 'kinetik.match.events',
    numPartitions: 5,
    replicationFactor: 1,
    description: 'Match orchestration events: window joins, match found, match expired',
    configEntries: [
      { name: 'retention.ms', value: '259200000' },        // 3 days
      { name: 'cleanup.policy', value: 'delete' },
      { name: 'compression.type', value: 'producer' },
    ],
  },
  {
    topic: 'kinetik.vibe.events',
    numPartitions: 1,
    replicationFactor: 1,
    description: 'Vibe check session events: start, phase changes, decisions, end',
    configEntries: [
      { name: 'retention.ms', value: '21600000' },         // 6 hours
      { name: 'cleanup.policy', value: 'delete' },
      { name: 'compression.type', value: 'producer' },
    ],
  },
  {
    topic: 'kinetik.window.events',
    numPartitions: 3,
    replicationFactor: 1,
    description: 'Flash window lifecycle events: scheduled, activated, countdown, closed',
    configEntries: [
      { name: 'retention.ms', value: '259200000' },        // 3 days
      { name: 'cleanup.policy', value: 'delete' },
      { name: 'compression.type', value: 'producer' },
    ],
  },
  {
    topic: 'kinetik.payment.events',
    numPartitions: 2,
    replicationFactor: 1,
    description: 'Payment and subscription events: orders, confirmations, failures',
    configEntries: [
      { name: 'retention.ms', value: '2592000000' },       // 30 days (audit trail)
      { name: 'cleanup.policy', value: 'delete' },
      { name: 'compression.type', value: 'producer' },
    ],
  },
  {
    topic: 'kinetik.notification.events',
    numPartitions: 1,
    replicationFactor: 1,
    description: 'Push notification triggers: match alerts, vibe reminders, promotional',
    configEntries: [
      { name: 'retention.ms', value: '86400000' },         // 1 day
      { name: 'cleanup.policy', value: 'delete' },
      { name: 'compression.type', value: 'producer' },
    ],
  },
];

// ─── Helpers ──────────────────────────────────────────────

function formatMs(ms: string): string {
  const num = parseInt(ms, 10);
  if (num >= 86400000) return `${num / 86400000}d`;
  if (num >= 3600000) return `${num / 3600000}h`;
  if (num >= 60000) return `${num / 60000}m`;
  return `${num / 1000}s`;
}

// ─── Main ─────────────────────────────────────────────────

async function main() {
  const brokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
  const clientId = process.env.KAFKA_CLIENT_ID || 'kinetik-admin';

  const kafka = new Kafka({ clientId, brokers });
  const admin: Admin = kafka.admin();
  let exitCode = 0;

  try {
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║       Kinetik Kafka Topic Admin                  ║');
    console.log('╚══════════════════════════════════════════════════╝');
    console.log();
    console.log(`  Brokers:    ${brokers.join(', ')}`);
    console.log(`  Client ID:  ${clientId}`);
    console.log();

    await admin.connect();
    console.log('  ✓ Connected to Kafka');
    console.log();

    // ── Fetch existing topics ─────────────────────────────
    const existingTopics = await admin.listTopics();
    const existingTopicMetadata = await admin.fetchTopicMetadata({
      topics: TOPICS.filter((t) => existingTopics.includes(t.topic)).map((t) => t.topic),
    });

    const existingMap = new Map(existingTopicMetadata.topics.map((t) => [t.name, t]));

    // ── Create / Validate each topic ──────────────────────
    for (const def of TOPICS) {
      const exists = existingMap.get(def.topic);
      const existingPartitions = exists?.partitions.length ?? 0;

      if (exists) {
        console.log(`  ℹ️  ${def.topic}`);
        console.log(`     Already exists (${existingPartitions} partitions)`);
        console.log(`     Description: ${def.description}`);

        // Check if partition count increased (Kafka only allows increasing partitions)
        if (def.numPartitions > existingPartitions) {
          console.log(`     → Creating ${def.numPartitions - existingPartitions} additional partition(s)...`);
          try {
            await admin.createPartitions({
              topicPartitions: [{
                topic: def.topic,
                count: def.numPartitions,
              }],
            });
            console.log(`     ✓ Partitions increased to ${def.numPartitions}`);
          } catch (err: any) {
            console.error(`     ✗ Failed to increase partitions: ${err.message}`);
            exitCode = 1;
          }
        }
      } else {
        console.log(`  ➕  ${def.topic}`);
        console.log(`     Partitions: ${def.numPartitions}, Replication: ${def.replicationFactor}`);
        console.log(`     Retention:  ${formatMs(def.configEntries!.find((c) => c.name === 'retention.ms')!.value)}`);
        console.log(`     Description: ${def.description}`);

        try {
          await admin.createTopics({
            topics: [def],
            waitForLeaders: true,
          });
          console.log(`     ✓ Created`);
        } catch (err: any) {
          // TOPIC_ALREADY_EXISTS is safe to ignore (race condition with AUTO_CREATE_TOPICS)
          if (err.message?.includes('TOPIC_ALREADY_EXISTS')) {
            console.log(`     ℹ️  Already exists (auto-created)`);
          } else {
            console.error(`     ✗ Failed: ${err.message}`);
            exitCode = 1;
          }
        }
      }
      console.log();
    }

    // ── Verify final state ────────────────────────────────
    console.log('  ─── Verifying topics ───');
    const finalTopics = await admin.listTopics();
    const finalMetadata = await admin.fetchTopicMetadata({
      topics: TOPICS.map((t) => t.topic).filter((t) => finalTopics.includes(t)),
    });

    for (const def of TOPICS) {
      const meta = finalMetadata.topics.find((m) => m.name === def.topic);
      if (meta) {
        const partitionCount = meta.partitions.length;
        const leaderPartitions = meta.partitions.filter((p) => p.leader !== null).length;
        const status = partitionCount >= def.numPartitions && leaderPartitions === partitionCount ? '✓' : '⚠';
        console.log(`  ${status} ${def.topic} (${partitionCount} partitions, ${leaderPartitions} leaders)`);
      } else {
        console.log(`  ✗ ${def.topic} — NOT FOUND`);
        exitCode = 1;
      }
    }

    console.log();
    if (exitCode === 0) {
      console.log('  ✅ All topics configured successfully');
    } else {
      console.log('  ⚠️  Completed with errors');
    }
  } catch (err: any) {
    console.error(`\n  ❌ Fatal error: ${err.message}`);
    exitCode = 1;
  } finally {
    await admin.disconnect();
    console.log('  Disconnected from Kafka');
    process.exit(exitCode);
  }
}

main();
