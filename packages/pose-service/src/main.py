"""
Kinetik Pose Service — Face detection & liveness verification + face matching.

Entry point that:
  - Starts a FastAPI server
  - Connects to PostgreSQL
  - Provides /verify endpoint that processes selfie images (liveness)
  - Provides /verify-face-match endpoint that compares selfie with profile photos
  - Updates user verification status in the database
"""

import asyncio
import base64
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


class FaceMatchRequest(BaseModel):
    user_id: str
    selfie_base64: str                          # Base64-encoded selfie image bytes
    profile_photo_urls: list[str]               # Relative URLs of user's existing profile photos
    min_match_threshold: float = 0.65            # Minimum similarity to consider a match


class FaceMatchResponse(BaseModel):
    match: bool                                  # Whether the selfie face matches profile photos
    confidence: float                            # Best similarity score
    scores: list[float]                          # Similarity scores per profile photo
    face_detected_in_selfie: bool
    profile_faces_detected: int                  # How many profile photos had detectable faces
    rejection_reasons: list[str]


# ─── Helper: build photo URL ──────────────────────────────────────

def _resolve_photo_url(relative_url: str) -> str:
    """Convert a relative photo URL to a full HTTP URL pointing at MinIO.

    Profile photo URLs in the DB are stored as '/uploads/{userId}/{photoId}.webp'.
    MinIO serves them at: http://{minio_endpoint}/{bucket}/{userId}/{photoId}.webp
    """
    # Strip the public URL prefix and prepend the MinIO bucket path
    if relative_url.startswith(settings.minio_public_url):
        object_key = relative_url[len(settings.minio_public_url):]
    else:
        object_key = relative_url.lstrip("/")

    return f"http://{settings.minio_endpoint}/{settings.minio_bucket}/{object_key}"


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
        photo_url = _resolve_photo_url(request.photo_url)

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


@app.post("/verify-face-match", response_model=FaceMatchResponse)
async def verify_face_match(request: FaceMatchRequest):
    """Compare a selfie face against the user's profile photos for identity verification.

    The selfie is provided as base64-encoded bytes (not stored to MinIO).
    Profile photos are fetched from MinIO using their stored URLs.
    """
    if not verifier or not pg_pool:
        raise HTTPException(status_code=503, detail="Service not ready")

    logger.info("Face-match request for user %s (%d profile photos)",
                request.user_id, len(request.profile_photo_urls))

    # ─── 1. Decode selfie ────────────────────────────────────
    try:
        selfie_bytes = base64.b64decode(request.selfie_base64)
        logger.info("Selfie decoded: %d bytes", len(selfie_bytes))
    except Exception as e:
        logger.error("Failed to decode selfie: %s", e)
        return FaceMatchResponse(
            match=False,
            confidence=0.0,
            scores=[],
            face_detected_in_selfie=False,
            profile_faces_detected=0,
            rejection_reasons=[f"Could not decode selfie: {e}"],
        )

    # ─── 2. Fetch profile photos ─────────────────────────────
    profile_images: list[tuple[bytes, str]] = []

    for url in request.profile_photo_urls:
        try:
            full_url = _resolve_photo_url(url)
            logger.info("Fetching profile photo from %s", full_url)
            response = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda u=full_url: urllib.request.urlopen(u, timeout=15),
            )
            img_bytes = response.read()
            profile_images.append((img_bytes, url))
            logger.info("Profile photo fetched: %d bytes", len(img_bytes))
        except Exception as e:
            logger.warning("Failed to fetch profile photo %s: %s", url, e)
            # Continue with remaining photos

    if not profile_images:
        return FaceMatchResponse(
            match=False,
            confidence=0.0,
            scores=[],
            face_detected_in_selfie=False,
            profile_faces_detected=0,
            rejection_reasons=["Could not fetch any profile photos"],
        )

    # ─── 3. Run face comparison ──────────────────────────────
    try:
        result = verifier.verify_face_match(
            selfie_bytes=selfie_bytes,
            profile_images=profile_images,
            min_match_threshold=request.min_match_threshold,
        )
    except Exception as e:
        logger.error("Face match failed: %s", e)
        return FaceMatchResponse(
            match=False,
            confidence=0.0,
            scores=[],
            face_detected_in_selfie=False,
            profile_faces_detected=0,
            rejection_reasons=[f"Face match error: {e}"],
        )

    logger.info(
        "Face-match result for user %s: match=%s confidence=%.4f scores=%s reasons=%s",
        request.user_id,
        result["match"],
        result["confidence"],
        result["scores"],
        result["rejection_reasons"],
    )

    return FaceMatchResponse(
        match=result["match"],
        confidence=result["confidence"],
        scores=result["scores"],
        face_detected_in_selfie=result["face_detected_in_selfie"],
        profile_faces_detected=result["profile_faces_detected"],
        rejection_reasons=result["rejection_reasons"],
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
