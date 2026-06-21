"""
Kafka client — async consumer and producer for the event-driven
match-engine pipeline using aiokafka.
"""

import json
import logging
from typing import Callable, Awaitable, Optional

from ..config import settings

logger = logging.getLogger(__name__)

try:
    from aiokafka import AIOKafkaConsumer, AIOKafkaProducer

    KAFKA_AVAILABLE = True
except ImportError:
    KAFKA_AVAILABLE = False
    logger.warning("aiokafka not available — Kafka features disabled")


# ─── Topic Constants (mirroring @kinetik/shared) ─────────────────

class KafkaTopics:
    WINDOW_EVENTS = "kinetik.window.events"
    MATCH_EVENTS = "kinetik.match.events"
    USER_EVENTS = "kinetik.user.events"


EventHandler = Callable[[str, dict], Awaitable[None]]


class KafkaClient:
    """Wraps an async Kafka consumer (for event processing) and producer (for match results)."""

    def __init__(self):
        self._producer: Optional[AIOKafkaProducer] = None
        self._consumer: Optional[AIOKafkaConsumer] = None
        self._running = False

    # ── Lifecycle ───────────────────────────────────────────────

    async def connect(self) -> None:
        """Initialise both producer and consumer."""
        if not KAFKA_AVAILABLE:
            logger.warning("Kafka not available — skipping connect")
            return

        brokers = settings.kafka_brokers.split(",")

        self._producer = AIOKafkaProducer(
            bootstrap_servers=brokers,
            client_id="kinetik-match-engine",
            acks=1,
            compression_type="gzip",
        )
        await self._producer.start()
        logger.info("Kafka producer connected to %s", brokers)

        self._consumer = AIOKafkaConsumer(
            *self._subscriptions(),
            bootstrap_servers=brokers,
            group_id="match-engine",
            auto_offset_reset="latest",
            enable_auto_commit=True,
            auto_commit_interval_ms=5000,
        )
        await self._consumer.start()
        logger.info("Kafka consumer started — subscribed to topics")

    async def disconnect(self) -> None:
        self._running = False
        if self._consumer:
            await self._consumer.stop()
        if self._producer:
            await self._producer.stop()
        logger.info("Kafka disconnected")

    # ── Producer ────────────────────────────────────────────────

    async def send_event(self, topic: str, key: str, payload: dict) -> None:
        """Publish an event to Kafka."""
        if self._producer is None:
            logger.warning("Kafka producer not started — skipping send")
            return
        await self._producer.send_and_wait(
            topic,
            key=key.encode(),
            value=json.dumps(payload).encode(),
        )

    # ── Consumer ────────────────────────────────────────────────

    async def run_consumer(self, handler: EventHandler) -> None:
        """Run the event consumer loop, dispatching messages to the given handler.

        The handler receives (topic, parsed_payload) and should process
        the event accordingly.
        """
        if self._consumer is None:
            logger.warning("Kafka consumer not started — event loop disabled")
            return

        self._running = True
        logger.info("Kafka consumer event loop started")

        try:
            async for msg in self._consumer:
                if not self._running:
                    break
                try:
                    topic = msg.topic
                    payload = json.loads(msg.value.decode())
                    logger.debug("Kafka event: %s – %s", topic, payload.get("type"))
                    await handler(topic, payload)
                except json.JSONDecodeError:
                    logger.warning("Invalid Kafka message on %s", msg.topic)
                except Exception as exc:
                    logger.error("Error processing Kafka event: %s", exc)
        finally:
            self._running = False

    # ── Internal ────────────────────────────────────────────────

    @staticmethod
    def _subscriptions() -> list[str]:
        return [
            KafkaTopics.WINDOW_EVENTS,
            KafkaTopics.MATCH_EVENTS,
            KafkaTopics.USER_EVENTS,
        ]
