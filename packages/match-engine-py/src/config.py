from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Server
    port: int = 3003
    host: str = "0.0.0.0"
    environment: str = "development"

    # Redis
    redis_host: str = "localhost"
    redis_port: int = 6379
    redis_password: str | None = None

    # Event Bus (dedicated Redis for pub/sub — replaces Kafka)
    redis_events_host: str = "localhost"
    redis_events_port: int = 6380
    redis_events_password: str | None = None

    # PostgreSQL
    database_url: str = "postgresql://kinetik:kinetik_dev_2024@localhost:5432/kinetik"

    # Window defaults
    window_duration_minutes: int = 30

    # Health check
    health_check_interval: int = 15

    model_config = {"env_prefix": "", "case_sensitive": False}


settings = Settings()
