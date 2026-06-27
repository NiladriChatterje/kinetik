"""
Kinetik Pose Service — Face detection & liveness verification.

Entry point that:
  - Starts a FastAPI server
  - Connects to PostgreSQL
  - Provides /verify endpoint that processes selfie images
  - Updates user liveness_status in the database
"""

import asyncio
import io
import logging
import urllib.request
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import asyncpg
import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from .config import settings
from .verifier import PoseVerifier, VerificationStatus

logger = logging.getLogger("kinetik.pose_service")

# ─── Global references ────────────────────────────────────────────
pg_pool: asyncpg.Pool | None = None
verifier: PoseVerifier | None = None


# ─── Lifespan ─────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown lifecycle."""
    global pg_pool, verifier

    logger.info("=" * 50)
    logger.info("  Kinetik Pose Service")
    logger.info("  Port: %s", settings.port)
    logger.info("=" * 50)

    # 1. PostgreSQL
    pg_pool = await asyncpg.create_pool(
        settings.database_url,
        min_size=2,
        max_size=10,
        command_timeout=30,
    )
    logger.info("PostgreSQL pool created")

    # 2. Pose Verifier (loads MediaPipe models)
    verifier = PoseVerifier()
    logger.info("PoseVerifier initialised")

    yield

    # ── Shutdown ────────────────────────────────────────────────
    logger.info("Shutting down pose service...")
    if pg_pool:
        await pg_pool.close()


# ─── FastAPI app ──────────────────────────────────────────────────

app = FastAPI(
    title="Kinetik Pose Service",
    version="0.1.0",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
)


@app.get("/health")
async def health():
    """Health-check endpoint."""
    return {
        "status": "ok",
        "service": "pose-service",
        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }


# ─── Request / Response models ────────────────────────────────────

class VerifyRequest(BaseModel):
    user_id: str
    photo_url: str          # URL to the selfie in MinIO / object storage


class VerifyResponse(BaseModel):
    status: str             # 'verified' | 'rejected'
    confidence: float
    face_detected: bool
    face_count: int
    head_yaw: float
    head_pitch: float
    head_roll: float
    liveness_score: float
    rejection_reasons: list[str]


# ─── Endpoints ────────────────────────────────────────────────────

@app.post("/verify", response_model=VerifyResponse)
async def verify_pose(request: VerifyRequest):
    """Verify a user's pose from their uploaded selfie.

    Fetches the photo from the provided URL, runs face detection,
    head pose estimation, and liveness heuristics, then updates
    the user's liveness_status in the database.
    """
    if not verifier or not pg_pool:
        raise HTTPException(status_code=503, detail="Service not ready")

    logger.info("Verification request for user %s", request.user_id)

    # ─── 1. Fetch the photo ──────────────────────────────────
    try:
        photo_url = request.photo_url
        # If the URL is a relative path (e.g. /uploads/...), prepend the public URL
        if photo_url.startswith("/"):
            photo_url = f"http://{settings.minio_endpoint}{photo_url}"

        logger.info("Fetching photo from %s", photo_url)
        response = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: urllib.request.urlopen(photo_url, timeout=15),
        )
        image_bytes = response.read()
        logger.info("Photo fetched: %d bytes", len(image_bytes))
    except Exception as e:
        logger.error("Failed to fetch photo: %s", e)
        # Mark as rejected — couldn't even retrieve the image
        await _update_liveness_status(request.user_id, "rejected")
        return VerifyResponse(
            status="rejected",
            confidence=0.0,
            face_detected=False,
            face_count=0,
            head_yaw=0, head_pitch=0, head_roll=0,
            liveness_score=0,
            rejection_reasons=[f"Could not fetch photo: {e}"],
        )

    # ─── 2. Run verification ─────────────────────────────────
    try:
        result = verifier.verify(image_bytes)
    except Exception as e:
        logger.error("Verification failed: %s", e)
        await _update_liveness_status(request.user_id, "rejected")
        return VerifyResponse(
            status="rejected",
            confidence=0.0,
            face_detected=False,
            face_count=0,
            head_yaw=0, head_pitch=0, head_roll=0,
            liveness_score=0,
            rejection_reasons=[f"Verification error: {e}"],
        )

    logger.info(
        "Verification result for user %s: status=%s confidence=%.3f reasons=%s",
        request.user_id,
        result.status.value,
        result.confidence,
        result.rejection_reasons,
    )

    # ─── 3. Update database ──────────────────────────────────
    await _update_liveness_status(request.user_id, result.status.value)

    return VerifyResponse(
        status=result.status.value,
        confidence=result.confidence,
        face_detected=result.face_detected,
        face_count=result.face_count,
        head_yaw=result.head_yaw,
        head_pitch=result.head_pitch,
        head_roll=result.head_roll,
        liveness_score=result.liveness_score,
        rejection_reasons=result.rejection_reasons,
    )


async def _update_liveness_status(user_id: str, status: str) -> None:
    """Update the user's liveness_status in the database."""
    if not pg_pool:
        logger.warning("No DB pool — skipping status update")
        return

    try:
        await pg_pool.execute(
            "UPDATE users SET liveness_status = $1 WHERE id = $2",
            status,
            user_id,
        )
        logger.info("Updated liveness_status=%s for user %s", status, user_id)
    except Exception as e:
        logger.error("Failed to update liveness_status: %s", e)


# ─── Entry point ──────────────────────────────────────────────────

def main():
    """Start the pose-service server.

    Usage:
        python -m src.main
        # or
        POSE_SERVICE_PORT=3004 python -m src.main
    """
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s %(message)s",
    )
    uvicorn.run(
        "src.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.environment == "development",
        log_level="info",
    )


if __name__ == "__main__":
    main()
