from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Server
    port: int = 3004
    host: str = "0.0.0.0"
    environment: str = "development"

    # PostgreSQL
    database_url: str = "postgresql://kinetik:kinetik_dev_2024@localhost:5432/kinetik"

    # MinIO / photo storage
    minio_endpoint: str = "localhost:9000"
    minio_access_key: str = "minioadmin"
    minio_secret_key: str = "minioadmin"
    minio_bucket: str = "kinetik-photos"
    minio_public_url: str = "/uploads/"

    # api-core internal URL (for callbacks if needed)
    api_core_url: str = "http://localhost:3001"

    # Verification thresholds
    min_face_confidence: float = 0.5       # Minimum face detection confidence
    min_face_count: int = 1                # Exactly 1 face expected
    max_face_count: int = 1                # Reject multi-face selfies
    max_head_yaw_deg: float = 30.0         # Max yaw (left/right turn) in degrees
    max_head_pitch_deg: float = 25.0       # Max pitch (up/down nod) in degrees
    min_image_width: int = 300             # Minimum image dimensions
    min_image_height: int = 300            # Minimum image dimensions

    model_config = {"env_prefix": "", "case_sensitive": False}


settings = Settings()
