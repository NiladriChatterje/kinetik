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

    # Kafka
    kafka_brokers: str = "localhost:9092"

    # PostgreSQL
    database_url: str = "postgresql://kinetik:kinetik_dev_2024@localhost:5432/kinetik"

    # CUDA / Device
    cuda_device: int = 0
    force_cpu: bool = False  # Set to True to disable CUDA even if available

    # NCF Model
    ncf_embedding_dim: int = 64
    ncf_hidden_dims: list[int] = [128, 64, 32]
    ncf_batch_size: int = 256
    ncf_learning_rate: float = 0.001
    ncf_model_path: str = "/data/models/ncf.pt"

    # Matching thresholds
    min_similarity_threshold: float = 0.3
    min_confidence_threshold: float = 0.2

    # Window defaults
    window_duration_minutes: int = 30

    # Health check
    health_check_interval: int = 15

    model_config = {"env_prefix": "", "case_sensitive": False}


settings = Settings()


def get_device() -> str:
    """Determine the compute device — CUDA if available, else CPU."""
    if settings.force_cpu:
        return "cpu"
    try:
        import torch
        if torch.cuda.is_available():
            return f"cuda:{settings.cuda_device}"
        return "cpu"
    except ImportError:
        return "cpu"
