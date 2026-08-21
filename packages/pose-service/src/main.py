"""
Kinetik Face Service — KYC document face matching.

Selfie liveness / pose verification now runs entirely on-device in the mobile
app (see POSE_VERIFICATION_ONDEVICE.md). This service remains for the one
check that can't run on the device: comparing the face on an uploaded KYC
document (government ID) against the user's profile photos.

Entry point that:
  - Starts a FastAPI server
  - Provides /verify-document-face endpoint (KYC document ↔ profile photos)
"""

import asyncio
import base64
import logging
import os
import urllib.request
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import cv2
import numpy as np
import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from .config import settings
from .verifier import PoseVerifier

# Optional: PDF to image conversion for KYC documents
try:
    import fitz  # PyMuPDF
    HAS_PDF_SUPPORT = True
except ImportError:
    HAS_PDF_SUPPORT = False
    fitz = None  # type: ignore


def _try_decode_image(image_bytes: bytes) -> np.ndarray | None:
    """Try to decode image bytes as an OpenCV image.

    If the bytes look like a PDF (start with '%PDF'), attempt
    to render the first page as an image using PyMuPDF.
    Returns None on failure.
    """
    # Check if it's a PDF
    if image_bytes[:4] == b'%PDF':
        if not HAS_PDF_SUPPORT or fitz is None:
            logger.warning("PDF document received but PyMuPDF is not installed")
            return None
        try:
            doc = fitz.open(stream=image_bytes, filetype="pdf")
            if doc.page_count == 0:
                logger.warning("PDF has no pages")
                return None
            page = doc[0]
            # Render at 200 DPI for decent quality
            pix = page.get_pixmap(matrix=fitz.Matrix(200 / 72, 200 / 72))
            img_bytes = pix.tobytes("png")
            doc.close()
            # Now decode the PNG bytes as OpenCV image
            nparr = np.frombuffer(img_bytes, np.uint8)
            frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            return frame
        except Exception as e:
            logger.error("Failed to convert PDF to image: %s", e)
            return None

    # Try decoding as a regular image
    nparr = np.frombuffer(image_bytes, np.uint8)
    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    return frame

logger = logging.getLogger("kinetik.pose_service")

# ─── Global references ────────────────────────────────────────────
verifier: PoseVerifier | None = None


# ─── Lifespan ─────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown lifecycle."""
    global verifier

    logger.info("=" * 50)
    logger.info("  Kinetik Face Service (KYC document matching)")
    logger.info("  Port: %s", settings.port)
    logger.info("=" * 50)

    # Pose Verifier (loads MediaPipe model)
    model_path = os.path.join(os.path.dirname(__file__), "..", settings.face_landmarker_model)
    verifier = PoseVerifier(model_path=model_path)
    logger.info("PoseVerifier initialised")

    yield

    logger.info("Shutting down face service...")


# ─── FastAPI app ──────────────────────────────────────────────────

app = FastAPI(
    title="Kinetik Face Service",
    version="0.2.0",
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

class DocFaceMatchRequest(BaseModel):
    user_id: str
    document_image: str                          # Base64-encoded document image (JPEG/PNG)
    profile_photo_urls: list[str]               # Relative URLs of user's existing profile photos
    min_match_threshold: float = 0.55            # Slightly lower threshold — document photos vary in quality


class DocFaceMatchResponse(BaseModel):
    match: bool                                  # Whether the face on the document matches profile photos
    confidence: float
    face_detected_in_document: bool
    profile_faces_detected: int
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

@app.post("/verify-document-face", response_model=DocFaceMatchResponse)
async def verify_document_face(request: DocFaceMatchRequest):
    """
    Extract a face from a KYC document image and compare it against the user's profile photos.

    This is used for identity verification: the face on a government ID (passport, license)
    is compared against the user's uploaded profile photos to ensure they're the same person.
    """
    if not verifier:
        raise HTTPException(status_code=503, detail="Service not ready")

    logger.info("Document face-match request for user %s", request.user_id)

    # ─── 1. Decode document image ───────────────────────────
    try:
        doc_image_bytes = base64.b64decode(request.document_image)
        logger.info("Document image decoded: %d bytes", len(doc_image_bytes))
    except Exception as e:
        logger.error("Failed to decode document image: %s", e)
        return DocFaceMatchResponse(
            match=False,
            confidence=0.0,
            face_detected_in_document=False,
            profile_faces_detected=0,
            rejection_reasons=[f"Could not decode document image: {e}"],
        )

    # ─── 2. Extract face from document image ────────────────
    # Handle both regular images and PDFs (convert first page to image)
    doc_frame = _try_decode_image(doc_image_bytes)
    if doc_frame is None:
        return DocFaceMatchResponse(
            match=False,
            confidence=0.0,
            face_detected_in_document=False,
            profile_faces_detected=0,
            rejection_reasons=[
                "Could not decode document. If this is a PDF, ensure PyMuPDF is installed. "
                "Otherwise, upload a JPG or PNG image of your ID."
            ],
        )

    # Re-encode as JPEG bytes for the verifier
    success, jpeg_buffer = cv2.imencode('.jpg', doc_frame, [cv2.IMWRITE_JPEG_QUALITY, 90])
    if not success:
        return DocFaceMatchResponse(
            match=False,
            confidence=0.0,
            face_detected_in_document=False,
            profile_faces_detected=0,
            rejection_reasons=["Could not process document image"],
        )
    doc_jpeg_bytes = jpeg_buffer.tobytes()

    # Use the verifier's _extract_descriptor to get a face descriptor from the document
    doc_desc, doc_face_found = verifier._extract_descriptor(doc_jpeg_bytes)

    if not doc_face_found:
        return DocFaceMatchResponse(
            match=False,
            confidence=0.0,
            face_detected_in_document=False,
            profile_faces_detected=0,
            rejection_reasons=["No face detected in document image"],
        )

    # ─── 3. Fetch profile photos ─────────────────────────────
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

    if not profile_images:
        return DocFaceMatchResponse(
            match=False,
            confidence=0.0,
            face_detected_in_document=True,
            profile_faces_detected=0,
            rejection_reasons=["Could not fetch any profile photos"],
        )

    # ─── 4. Extract face descriptors from profile photos ─────
    profile_descriptors: list[tuple] = []
    for img_bytes, label in profile_images:
        desc, face_found = verifier._extract_descriptor(img_bytes)
        if face_found:
            profile_descriptors.append((desc, label))

    if len(profile_descriptors) < 2:
        return DocFaceMatchResponse(
            match=False,
            confidence=0.0,
            face_detected_in_document=True,
            profile_faces_detected=len(profile_descriptors),
            rejection_reasons=[
                f"Only {len(profile_descriptors)} of {len(profile_images)} profile photos "
                f"have detectable faces — need at least 2"
            ],
        )

    # ─── 5. Compute similarity scores ────────────────────────
    scores: list[float] = []
    for desc, label in profile_descriptors:
        sim = verifier.compare_face_descriptors(doc_desc, desc)
        scores.append(round(sim, 4))
        logger.info("Document face match score with %s: %.4f", label, sim)

    # Best-of-N: take the highest similarity score
    best_score = max(scores)
    avg_score = sum(scores) / len(scores)
    confidence = best_score * 0.7 + avg_score * 0.3

    is_match = confidence >= request.min_match_threshold
    rejection_reasons: list[str] = []

    if not is_match:
        rejection_reasons.append(
            f"Document face match confidence {confidence:.3f} below threshold {request.min_match_threshold}"
        )

    logger.info(
        "Document face-match result for user %s: match=%s confidence=%.4f scores=%s",
        request.user_id,
        is_match,
        confidence,
        scores,
    )

    return DocFaceMatchResponse(
        match=is_match,
        confidence=round(confidence, 4),
        face_detected_in_document=True,
        profile_faces_detected=len(profile_descriptors),
        rejection_reasons=rejection_reasons,
    )


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
