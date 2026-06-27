#!/bin/sh
set -e

echo "⏳ Creating/verifying Kafka topics..."
max_attempts=10
attempt=1

while [ "$attempt" -le "$max_attempts" ]; do
  if npx tsx /app/kafkaAdmin.ts; then
    echo "✅ Kafka topics ready"
    exit 0
  fi
  echo "⚠️  Attempt $attempt/$max_attempts failed, retrying in 5s..."
  attempt=$((attempt + 1))
  sleep 5
done

echo "❌ Failed to create Kafka topics after $max_attempts attempts"
exit 1
