"""
Event Bus client — Redis pub/sub client for the event-driven
match-engine pipeline. Replaces the previous aiokafka-based KafkaClient.

Uses a separate Redis connection (REDIS_EVENTS_HOST) from the main
Redis used for caching and Celery broker.
"""

import json
import logging
from datetime import datetime, timezone
from typing import Any, Callable, Awaitable, Optional

from ..config import settings

logger = logging.getLogger(__name__)

try:
    from redis.asyncio import Redis as AsyncRedis
    REDIS_AVAILABLE = True
except ImportError:
    REDIS_AVAILABLE = False
    logger.warning("redis.asyncio not available — event bus disabled")


# ─── Channel Constants (mirroring @kinetik/shared EVENT_BUS_CHANNELS) ─

class EventBusChannels:
    WINDOW_EVENTS = "event:window"
    MATCH_EVENTS = "event:match"
    VIBE_EVENTS = "event:vibe"
    USER_EVENTS = "event:user"
    PAYMENT_EVENTS = "event:payment"


EventHandler = Callable[[str, dict], Awaitable[None]]


class EventBusClient:
    """Wraps an async Redis pub/sub client for event-driven communication.

    Connects to the dedicated event-bus Redis instance (separate from the
    main Redis used for caching/Celery). This prevents event storms from
    impacting latency-sensitive operations.
    """

    def __init__(self):
        self._pubsub: Any = None
        self._redis: Any = None
        self._running = False

    async def connect(self) -> None:
        """Create the Redis connection for the event bus."""
        if not REDIS_AVAILABLE:
            logger.warning("redis.asyncio not available — skipping event bus connect")
            return

        host = settings.redis_events_host
        port = settings.redis_events_port
        password = settings.redis_events_password

        self._redis = AsyncRedis(
            host=host,
            port=port,
            password=password or None,
            socket_connect_timeout=5,
            socket_timeout=5,
            retry_on_timeout=True,
        )
        await self._redis.ping()
        logger.info("Event bus Redis connected to %s:%s", host, port)

    async def disconnect(self) -> None:
        self._running = False
        if self._pubsub:
            await self._pubsub.unsubscribe()
            await self._pubsub.close()
            self._pubsub = None
        if self._redis:
            await self._redis.close()
            self._redis = None
        logger.info("Event bus disconnected")

    async def send_event(self, channel: str, key: str, payload: dict) -> None:
        """Publish an event to the event bus (fire-and-forget)."""
        if self._redis is None:
            logger.warning("Event bus not connected — skipping send")
            return

        message = {
            "type": key,
            "payload": payload,
            "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        }
        await self._redis.publish(channel, json.dumps(message))

    async def run_consumer(self, handler: EventHandler) -> None:
        """Subscribe to all relevant channels and dispatch events to handler.

        The handler receives (channel, parsed_payload) and should process
        the event accordingly.
        """
        if self._redis is None:
            logger.warning("Event bus not started — consumer disabled")
            return

        self._pubsub = self._redis.pubsub()
        channels = [
            EventBusChannels.WINDOW_EVENTS,
            EventBusChannels.MATCH_EVENTS,
            EventBusChannels.USER_EVENTS,
        ]
        await self._pubsub.subscribe(*channels)
        self._running = True
        logger.info("Event bus consumer subscribed to: %s", channels)

        try:
            async for message in self._pubsub.listen():
                if not self._running:
                    break
                if message["type"] != "message":
                    continue

                try:
                    channel = message["channel"]
                    if isinstance(channel, bytes):
                        channel = channel.decode()
                    payload = json.loads(message["data"])
                    logger.debug("Event bus event: %s – %s", channel, payload.get("type"))
                    await handler(channel, payload)
                except json.JSONDecodeError:
                    logger.warning("Invalid event bus message on %s", message.get("channel"))
                except Exception as exc:
                    logger.error("Error processing event bus event: %s", exc)
        finally:
            self._running = False
            if self._pubsub:
                await self._pubsub.unsubscribe()
                await self._pubsub.close()
                self._pubsub = None
