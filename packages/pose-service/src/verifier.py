"""
Face Verifier — MediaPipe Tasks API face detection + face comparison.

Used by the KYC document face-match endpoint. Selfie face verification now
runs on-device in the mobile app (FACE_VERIFICATION_ONDEVICE.md).

Face comparison (photo match):
  1. Detect and extract landmarks in each image
  2. Compute normalized landmark feature vector per face
  3. Cosine similarity between the two vectors
"""

import logging
import os

import cv2
import mediapipe as mp
import numpy as np

logger = logging.getLogger("kinetik.pose_service.verifier")

# ─── Model paths ─────────────────────────────────────────────────
# The .task model files live alongside the package or in a configurable directory.
_MODELS_DIR = os.path.join(os.path.dirname(__file__), "..", "models")
_FACE_LANDMARKER_PATH = os.path.join(_MODELS_DIR, "face_landmarker.task")


class PoseVerifier:
    """Stateless face descriptor extractor using MediaPipe Tasks API + OpenCV."""

    def __init__(self, model_path: str | None = None):
        resolved_path = model_path or _FACE_LANDMARKER_PATH
        if not os.path.exists(resolved_path):
            raise FileNotFoundError(
                f"Face landmarker model not found at {resolved_path}. "
                "Download from: https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task"
            )

        base_options = mp.tasks.BaseOptions(model_asset_path=resolved_path)
        options = mp.tasks.vision.FaceLandmarkerOptions(
            base_options=base_options,
            num_faces=1,
            min_face_detection_confidence=0.5,
            min_face_presence_confidence=0.5,
            output_face_blendshapes=False,
            output_facial_transformation_matrixes=False,
        )
        self._landmarker = mp.tasks.vision.FaceLandmarker.create_from_options(options)

        logger.info("PoseVerifier initialised (MediaPipe Tasks API — FaceLandmarker)")

    # ─── Face Descriptor ─────────────────────────────────────

    @staticmethod
    def _compute_face_descriptor(face_landmarks) -> np.ndarray:
        """
        Compute a normalised feature vector from FaceLandmarker landmarks.

        The descriptor consists of normalised inter-landmark distances.
        Uses a subset of key facial landmarks (eyes, nose, mouth, jaw)
        and computes pairwise distances normalised by the inter-ocular
        distance (distance between outer corners of left and right eyes).

        Returns a 1D numpy array of normalised distances.
        """
        # Key landmark indices for face description (subset)
        # These cover the main facial structure without being too sparse
        KEY_INDICES = [
            # Nose
            1, 2, 4, 5, 6,
            # Left eye
            33, 133, 157, 158, 159, 160, 161, 173, 246,
            # Right eye
            263, 362, 380, 381, 382, 384, 385, 386, 387, 388, 466,
            # Left eyebrow
            46, 53, 52, 65, 55, 70, 105, 66, 107,
            # Right eyebrow
            276, 283, 282, 285, 300, 293, 334, 296, 336,
            # Mouth
            61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185,
            # Jaw contour
            10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 400, 377,
        ]

        # Get inter-ocular distance (outer eye corners: landmarks 33 and 263)
        left_eye_outer = np.array([face_landmarks[33].x, face_landmarks[33].y, face_landmarks[33].z])
        right_eye_outer = np.array([face_landmarks[263].x, face_landmarks[263].y, face_landmarks[263].z])
        inter_ocular = np.linalg.norm(left_eye_outer - right_eye_outer)

        if inter_ocular < 0.001:
            inter_ocular = 0.1  # Fallback to avoid division by zero

        # Get nose tip as reference point for centering
        nose_tip = np.array([face_landmarks[1].x, face_landmarks[1].y, face_landmarks[1].z])

        # Build descriptor: normalised offset of each key landmark from nose tip
        descriptor_components = []
        for idx in KEY_INDICES:
            lm = face_landmarks[idx]
            pt = np.array([lm.x, lm.y, lm.z])
            offset = (pt - nose_tip) / inter_ocular
            descriptor_components.extend([offset[0], offset[1], offset[2]])

        descriptor = np.array(descriptor_components, dtype=np.float64)

        # L2-normalise the descriptor for cosine similarity
        norm = np.linalg.norm(descriptor)
        if norm > 1e-6:
            descriptor = descriptor / norm

        return descriptor

    # ─── Face Comparison ────────────────────────────────────

    @staticmethod
    def compare_face_descriptors(
        desc_a: np.ndarray,
        desc_b: np.ndarray,
    ) -> float:
        """
        Compare two face descriptors and return a similarity score (0..1).

        Uses cosine similarity between the two normalised vectors.
        """
        similarity = float(np.dot(desc_a, desc_b))
        # Clamp to [0, 1] — cosine similarity for normalised vectors is [-1, 1]
        return max(0.0, min(1.0, similarity))

    def _extract_descriptor(self, image_bytes: bytes) -> tuple[np.ndarray | None, bool]:
        """
        Extract a face descriptor from raw image bytes.

        Returns (descriptor, face_found). descriptor is None if no face detected.
        """
        nparr = np.frombuffer(image_bytes, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if frame is None:
            return None, False

        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        h, w = frame.shape[:2]

        if w < 100 or h < 100:
            return None, False

        # Run FaceLandmarker to get landmarks
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        result = self._landmarker.detect(mp_image)

        if not result.face_landmarks:
            return None, False

        face_landmarks = result.face_landmarks[0]
        descriptor = self._compute_face_descriptor(face_landmarks)

        return descriptor, True
