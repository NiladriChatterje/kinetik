"""
Pose Verifier — MediaPipe Tasks API face detection + liveness + face comparison.

Pipeline (liveness check):
  1. Decode image bytes → OpenCV matrix
  2. Detect face via FaceLandmarker (Tasks API)
  3. Extract 478 landmarks
  4. Estimate head pose (yaw/pitch/roll) via OpenCV solvePnP
  5. Run liveness heuristics (face size, blur, edge density)
  6. Return structured verification result

Face comparison (photo match):
  1. Detect and extract landmarks in selfie
  2. Detect and extract landmarks in each profile photo
  3. Compute normalized landmark feature vector per face
  4. Cosine similarity between selfie vector and each profile photo vector
  5. Return match verdict averaging best N scores
"""

import io
import logging
import math
import os
from dataclasses import dataclass, field
from enum import Enum

import cv2
import mediapipe as mp
import numpy as np

logger = logging.getLogger("kinetik.pose_service.verifier")

# ─── Model paths ─────────────────────────────────────────────────
# The .task model files live alongside the package or in a configurable directory.
_MODELS_DIR = os.path.join(os.path.dirname(__file__), "..", "models")
_FACE_LANDMARKER_PATH = os.path.join(_MODELS_DIR, "face_landmarker.task")

# 3D model points for head pose estimation (canonical generic face model,
# units are millimetres, y-up). Eye corners sit left/right of the nose (±x),
# NOT along the depth axis. Indices correspond to MediaPipe FaceMesh landmarks:
#   1 = nose tip, 33 = left eye outer corner, 263 = right eye outer corner,
#   61 = left mouth corner, 291 = right mouth corner, 152 = chin
MODEL_POINTS_3D = np.array([
    [0.0,      0.0,     0.0],     # Nose tip (landmark 1)
    [-225.0,  170.0,  -135.0],    # Left eye outer corner (landmark 33)
    [225.0,   170.0,  -135.0],    # Right eye outer corner (landmark 263)
    [-150.0, -150.0,  -125.0],    # Left mouth corner (landmark 61)
    [150.0,  -150.0,  -125.0],    # Right mouth corner (landmark 291)
    [0.0,    -330.0,   -65.0],    # Chin (landmark 152)
], dtype=np.float64)

# MediaPipe FaceMesh landmark indices matching the 3D model points
LANDMARK_INDICES = [1, 33, 263, 61, 291, 152]


class VerificationStatus(str, Enum):
    VERIFIED = "verified"
    REJECTED = "rejected"
    PENDING = "pending"


@dataclass
class VerificationResult:
    status: VerificationStatus
    confidence: float
    face_detected: bool
    face_count: int
    head_yaw: float          # degrees, positive = turned right
    head_pitch: float        # degrees, positive = looking up
    head_roll: float         # degrees
    liveness_score: float    # 0.0–1.0
    rejection_reasons: list[str] = field(default_factory=list)


class PoseVerifier:
    """Stateless pose verifier using MediaPipe Tasks API + OpenCV."""

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
            output_facial_transformation_matrixes=False,  # We compute pose via solvePnP
        )
        self._landmarker = mp.tasks.vision.FaceLandmarker.create_from_options(options)

        logger.info("PoseVerifier initialised (MediaPipe Tasks API — FaceLandmarker)")

    def verify(self, image_bytes: bytes) -> VerificationResult:
        """Run the full verification pipeline on a raw image."""
        rejection_reasons: list[str] = []
        face_detected = False
        face_count = 0
        head_yaw = 0.0
        head_pitch = 0.0
        head_roll = 0.0
        liveness_score = 0.0

        # ─── 1. Decode image ─────────────────────────────────
        nparr = np.frombuffer(image_bytes, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if frame is None:
            return VerificationResult(
                status=VerificationStatus.REJECTED,
                confidence=0.0,
                face_detected=False,
                face_count=0,
                head_yaw=0, head_pitch=0, head_roll=0,
                liveness_score=0,
                rejection_reasons=["Could not decode image"],
            )

        h, w = frame.shape[:2]
        logger.info("Image decoded: %dx%d", w, h)

        # ─── 2. Basic image quality checks ───────────────────
        if w < 300 or h < 300:
            rejection_reasons.append(f"Image too small ({w}x{h}, minimum 300x300)")

        # Check blurriness via Laplacian variance
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        blur_score = cv2.Laplacian(gray, cv2.CV_64F).var()
        if blur_score < 50:
            rejection_reasons.append(f"Image too blurry (score={blur_score:.1f}, min=50)")

        # ─── 3. Face detection via FaceLandmarker ────────────
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        result = self._landmarker.detect(mp_image)

        if result.face_landmarks:
            face_count = len(result.face_landmarks)
            face_detected = True
            logger.info("Detected %d face(s)", face_count)

            if face_count > 1:
                rejection_reasons.append(f"Multiple faces detected ({face_count}, expected 1)")

            # ─── 4. Head pose estimation via solvePnP ────────
            # Use the first face's landmarks
            face_landmarks = result.face_landmarks[0]

            # Extract 2D landmark points for the 6 reference landmarks
            points_2d = []
            for idx in LANDMARK_INDICES:
                lm = face_landmarks[idx]
                points_2d.append([lm.x * w, lm.y * h])

            points_2d = np.array(points_2d, dtype=np.float64)

            # Camera matrix (approximate for selfie camera)
            focal_length = w
            center = (w / 2, h / 2)
            camera_matrix = np.array([
                [focal_length, 0, center[0]],
                [0, focal_length, center[1]],
                [0, 0, 1],
            ], dtype=np.float64)

            dist_coeffs = np.zeros((4, 1), dtype=np.float64)

            success, rotation_vec, translation_vec = cv2.solvePnP(
                MODEL_POINTS_3D,
                points_2d,
                camera_matrix,
                dist_coeffs,
                flags=cv2.SOLVEPNP_ITERATIVE,
            )

            if success:
                # Convert rotation vector to Euler angles
                rotation_mat, _ = cv2.Rodrigues(rotation_vec)
                pose_mat = np.hstack((rotation_mat, translation_vec))
                _, _, _, _, _, _, euler = cv2.decomposeProjectionMatrix(
                    np.vstack((pose_mat, [0, 0, 0, 1]))[:3]
                )
                head_pitch = float(euler[0][0])
                head_yaw = float(euler[1][0])
                head_roll = float(euler[2][0])

                # The y-up model against y-down image coordinates puts a
                # frontal face's pitch/roll near ±180° — fold back around 0
                if head_pitch > 90:
                    head_pitch -= 180
                elif head_pitch < -90:
                    head_pitch += 180
                if head_roll > 90:
                    head_roll -= 180
                elif head_roll < -90:
                    head_roll += 180

                logger.info(
                    "Head pose — yaw=%.1f° pitch=%.1f° roll=%.1f°",
                    head_yaw, head_pitch, head_roll,
                )

                # Check pose thresholds
                if abs(head_yaw) > 30.0:
                    rejection_reasons.append(
                        f"Head turned too far sideways (yaw={head_yaw:.1f}°, max=30°)"
                    )
                if abs(head_pitch) > 25.0:
                    rejection_reasons.append(
                        f"Head tilted too far up/down (pitch={head_pitch:.1f}°, max=25°)"
                    )
            else:
                rejection_reasons.append("Could not estimate head pose")

            # ─── 5. Liveness heuristics ─────────────────────
            liveness_score = self._compute_liveness_score(
                frame, gray, face_landmarks, w, h, blur_score,
            )
            logger.info("Liveness score: %.2f", liveness_score)

            if liveness_score < 0.3:
                rejection_reasons.append(
                    f"Liveness score too low ({liveness_score:.2f}, min=0.3)"
                )
        else:
            rejection_reasons.append("No face detected in image")

        # ─── 6. Determine final status ──────────────────────
        if not face_detected:
            status = VerificationStatus.REJECTED
            confidence = 0.0
        elif rejection_reasons:
            status = VerificationStatus.REJECTED
            confidence = liveness_score * 0.5  # Partial confidence
        else:
            status = VerificationStatus.VERIFIED
            confidence = min(1.0, liveness_score * 0.7 + 0.3)

        return VerificationResult(
            status=status,
            confidence=round(confidence, 3),
            face_detected=face_detected,
            face_count=face_count,
            head_yaw=round(head_yaw, 2),
            head_pitch=round(head_pitch, 2),
            head_roll=round(head_roll, 2),
            liveness_score=round(liveness_score, 3),
            rejection_reasons=rejection_reasons,
        )

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

    def verify_face_match(
        self,
        selfie_bytes: bytes,
        profile_images: list[tuple[bytes, str]],
        min_match_threshold: float = 0.65,
    ) -> dict:
        """
        Verify that the face in the selfie matches the faces in the user's profile photos.

        Args:
            selfie_bytes: Raw image bytes of the selfie.
            profile_images: List of (image_bytes, label) tuples for profile photos.
            min_match_threshold: Minimum similarity to consider a match.

        Returns:
            dict with:
              - match (bool): whether the face matches
              - confidence (float): best similarity score
              - scores (list[float]): similarity scores per profile photo
              - face_detected_in_selfie (bool)
              - profile_faces_detected (int): how many profile photos had a detectable face
              - rejection_reasons (list[str])
        """
        rejection_reasons: list[str] = []

        # ─── 1. Extract descriptor from selfie ──────────────
        selfie_descriptor, selfie_face_detected = self._extract_descriptor(selfie_bytes)

        if not selfie_face_detected:
            return {
                "match": False,
                "confidence": 0.0,
                "scores": [],
                "face_detected_in_selfie": False,
                "profile_faces_detected": 0,
                "rejection_reasons": ["No face detected in selfie"],
            }

        # ─── 2. Extract descriptors from profile photos ─────
        profile_descriptors: list[tuple[np.ndarray, str]] = []
        for img_bytes, label in profile_images:
            desc, face_found = self._extract_descriptor(img_bytes)
            if face_found:
                profile_descriptors.append((desc, label))

        if len(profile_descriptors) < 2:
            rejection_reasons.append(
                f"Only {len(profile_descriptors)} of {len(profile_images)} profile photos "
                f"have detectable faces — need at least 2"
            )

        # ─── 3. Compute similarity scores ───────────────────
        scores: list[float] = []
        for desc, label in profile_descriptors:
            sim = self.compare_face_descriptors(selfie_descriptor, desc)
            scores.append(round(sim, 4))
            logger.info("Face match score with %s: %.4f", label, sim)

        if not scores:
            return {
                "match": False,
                "confidence": 0.0,
                "scores": [],
                "face_detected_in_selfie": True,
                "profile_faces_detected": len(profile_descriptors),
                "rejection_reasons": rejection_reasons or ["No profile photos with detectable faces"],
            }

        # ─── 4. Determine match ─────────────────────────────
        # Best-of-N: take the highest similarity score
        best_score = max(scores)
        avg_score = sum(scores) / len(scores)
        # Use a blend of best and average for robustness
        confidence = best_score * 0.7 + avg_score * 0.3

        # A match requires at least 2 profile photos with detectable faces —
        # a single-photo comparison is too weak to grant the verified badge
        is_match = len(profile_descriptors) >= 2 and confidence >= min_match_threshold

        if not is_match and confidence < min_match_threshold:
            rejection_reasons.append(
                f"Face match confidence {confidence:.3f} below threshold {min_match_threshold}"
            )

        return {
            "match": is_match,
            "confidence": round(confidence, 4),
            "scores": scores,
            "face_detected_in_selfie": True,
            "profile_faces_detected": len(profile_descriptors),
            "rejection_reasons": rejection_reasons,
        }

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

    def _compute_liveness_score(
        self,
        frame: np.ndarray,
        gray: np.ndarray,
        face_landmarks,
        w: int,
        h: int,
        blur_score: float,
    ) -> float:
        """Heuristic liveness score from 0.0 (spoof) to 1.0 (live)."""
        score = 0.0
        checks = 0

        # Check 1: Face occupies reasonable portion of image
        xs = [lm.x for lm in face_landmarks]
        ys = [lm.y for lm in face_landmarks]
        face_w = (max(xs) - min(xs)) * w
        face_h = (max(ys) - min(ys)) * h
        face_area_ratio = (face_w * face_h) / (w * h)
        if 0.05 < face_area_ratio < 0.85:
            checks += 1
            score += 1.0
        elif face_area_ratio <= 0.05:
            checks += 1
            score += 0.2  # Face too small (might be a photo of a photo)

        # Check 2: Edge density around face (screens/paper have different edges)
        face_roi = gray[
            int(min(ys) * h):int(max(ys) * h),
            int(min(xs) * w):int(max(xs) * w),
        ]
        if face_roi.size > 0:
            edges = cv2.Canny(face_roi, 50, 150)
            edge_density = np.mean(edges > 0)
            checks += 1
            # Real faces have moderate edge density; screens have too many regular edges
            if 0.02 < edge_density < 0.25:
                score += 1.0
            else:
                score += 0.3

        # Check 3: Blurriness (very blurry = likely a photo of a photo)
        checks += 1
        if blur_score > 200:
            score += 1.0
        elif blur_score > 50:
            score += 0.6
        else:
            score += 0.1

        # Check 4: Symmetry check — real faces are roughly symmetric.
        top, bottom = int(min(ys) * h), int(max(ys) * h)
        left, right = int(min(xs) * w), int(max(xs) * w)
        face_center_x = int(np.mean(xs) * w)
        if bottom > top and left < face_center_x < right:
            left_half = gray[top:bottom, left:face_center_x]
            right_half = cv2.flip(gray[top:bottom, face_center_x:right], 1)
            min_w = min(left_half.shape[1], right_half.shape[1])
            if min_w > 10:
                diff = cv2.absdiff(
                    left_half[:, :min_w],
                    right_half[:, :min_w],
                )
                symmetry_score = 1.0 - (np.mean(diff) / 255.0)
                checks += 1
                if symmetry_score > 0.5:
                    score += 1.0
                else:
                    score += 0.3

        return score / checks if checks > 0 else 0.0
