from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Server
    port: int = 3004
    host: str = "0.0.0.0"
    environment: str = "development"

    # MinIO / photo storage (profile photos are fetched over plain HTTP)
    minio_endpoint: str = "localhost:9000"
    minio_bucket: str = "kinetik-photos"
    minio_public_url: str = "/uploads/"

    # MediaPipe model path (relative to package root or absolute)
    face_landmarker_model: str = "models/face_landmarker.task"

    model_config = {"env_prefix": "", "case_sensitive": False}


settings = Settings()
