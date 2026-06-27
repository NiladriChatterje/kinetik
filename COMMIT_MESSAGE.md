fix: Kafka InconsistentClusterIdException + optimize kafka-init with pre-built image

Issues fixed:
- Kafka crash loop: Zookeeper had no persistent volume, so on restart it
  generated a new cluster ID, causing InconsistentClusterIdException.
  Fixed by adding named volumes for Zookeeper (data + datalog) and
  setting KAFKA_CLUSTER_ID explicitly so Kafka always uses a consistent
  cluster ID regardless of Zookeeper state.
- Nginx, api-core, realtime stuck in "Created" state because they
  depended on kafka-init, which depended on a crashing Kafka.

Infrastructure:
- docker-compose.yml: Added zookeeper-data + zookeeper-datalog volumes
- docker-compose.yml: Added ZOOKEEPER_DATA_LOG_DIR env var
- docker-compose.yml: Set KAFKA_CLUSTER_ID with default cluster ID
- docker-compose.yml: Increased resource limits for kafka and api-core
- Added MinIO S3-compatible storage env vars to api-core service

Photo pipeline:
- Added blurhash dependency for progressive image loading
- photoStorage.ts: Generate BlurHash during photo upload (4x3 components)
- photos.ts: Store blur_hash in DB, delete from MinIO directly
- users.ts: Removed duplicate /photos GET route
- api.ts: deletePhoto now throws on failure for proper error handling

Match engine (Python):
- Renamed RedisClient.set() to set_value() to avoid shadowing built-in
- Updated all callers (spatial.py, redis_client.py)
- Fixed entrypoint-celery.sh working directory path

Kafka-init optimization:
- Created scripts/Dockerfile.kafka-init with pre-installed deps
- Created scripts/entrypoint-kafka-init.sh with retry logic (10 attempts)
- Created scripts/package.json with kafkajs + tsx dependencies
- Eliminated runtime npm install (~15s saved per startup)
