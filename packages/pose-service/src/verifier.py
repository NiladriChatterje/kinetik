"""
Pose Verifier — MediaPipe face detection + head pose estimation.

Pipeline:
  1. Decode image bytes → OpenCV matrix
  2. Detect face(s) via MediaPipe FaceDetection
  3. Extract 468 landmarks via MediaPipe FaceMesh
  4. Estimate head pose (yaw/pitch/roll) via OpenCV solvePnP
  5. Run liveness heuristics (face size, blur, edge density)
  6. Return structured verification result
"""

import io
import logging
import math
from dataclasses import dataclass, field
from enum import Enum

import cv2
import mediapipe as mp
import numpy as np

logger = logging.getLogger("kinetik.pose_service.verifier")

# ─── MediaPipe static image mode model paths ─────────────────────
# Using the Tasks API (newer) approach with the legacy solutions
# for broader compatibility in Docker.

# 3D model points for head pose estimation (generic face model)
# Indices correspond to MediaPipe FaceMesh landmarks:
#   1 = nose tip, 33 = left eye outer corner, 263 = right eye outer corner,
#   61 = left mouth corner, 291 = right mouth corner, 199 = chin
MODEL_POINTS_3D = np.array([
    [0.0,     0.0,     0.0],      # Nose tip (landmark 1)
    [0.0,    -63.6,   -12.5],     # Left eye outer corner (landmark 33)
    [0.0,    -63.6,    12.5],     # Right eye outer corner (landmark 263)
    [-43.3,   32.7,   -26.0],     # Left mouth corner (landmark 61)
    [43.3,    32.7,   -26.0],     # Right mouth corner (landmark 291)
    [0.0,     71.4,   -76.0],     # Chin (landmark 199)
], dtype=np.float64)

# MediaPipe FaceMesh landmark indices matching the 3D model points
LANDMARK_INDICES = [1, 33, 263, 61, 291, 199]


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
    """Stateless pose verifier using MediaPipe + OpenCV."""

    def __init__(self):
        # ─── Face Detection ──────────────────────────────────
        self._face_detection = mp.solutions.face_detection.FaceDetection(
            model_selection=1,       # 1 = full-range model (works better for selfies)
            min_detection_confidence=0.5,
        )

        # ─── Face Mesh (landmarks) ──────────────────────────
        self._face_mesh = mp.solutions.face_mesh.FaceMesh(
            static_image_mode=True,
            max_num_faces=1,
            refine_landmarks=True,
            min_detection_confidence=0.5,
        )

        logger.info("PoseVerifier initialised (MediaPipe FaceDetection + FaceMesh)")

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

        # ─── 3. Face detection ──────────────────────────────
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        detection_result = self._face_detection.process(rgb)

        if detection_result.detections:
            face_count = len(detection_result.detections)
            face_detected = True
            logger.info("Detected %d face(s)", face_count)

            if face_count > 1:
                rejection_reasons.append(f"Multiple faces detected ({face_count}, expected 1)")
        else:
            rejection_reasons.append("No face detected in image")

        # ─── 4. Face mesh landmarks ─────────────────────────
        mesh_result = self._face_mesh.process(rgb)

        if mesh_result.multi_face_landmarks and face_detected:
            landmarks = mesh_result.multi_face_landmarks[0]

            # Extract 2D landmark points for the 6 reference landmarks
            points_2d = []
            for idx in LANDMARK_INDICES:
                lm = landmarks.landmark[idx]
                points_2d.append([lm.x * w, lm.y * h])

            points_2d = np.array(points_2d, dtype=np.float64)

            # ─── 5. Head pose estimation via solvePnP ───────
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

            # ─── 6. Liveness heuristics ─────────────────────
            liveness_score = self._compute_liveness_score(
                frame, gray, landmarks, w, h, blur_score,
            )
            logger.info("Liveness score: %.2f", liveness_score)

            if liveness_score < 0.3:
                rejection_reasons.append(
                    f"Liveness score too low ({liveness_score:.2f}, min=0.3)"
                )

        # ─── 7. Determine final status ──────────────────────
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

    def _compute_liveness_score(
        self,
        frame: np.ndarray,
        gray: np.ndarray,
        landmarks,
        w: int,
        h: int,
        blur_score: float,
    ) -> float:
        """Heuristic liveness score from 0.0 (spoof) to 1.0 (live)."""
        score = 0.0
        checks = 0

        # Check 1: Face occupies reasonable portion of image
        # Use the bounding box from landmarks
        xs = [lm.x for lm in landmarks.landmark]
        ys = [lm.y for lm in landmarks.landmark]
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

        # Check 4: Symmetry check — real faces are roughly symmetric
        # Compare left and right halves of the face
        face_center_x = int(np.mean(xs) * w)
        left_half = gray[:, :face_center_x]
        right_half = cv2.flip(gray[:, face_center_x:], 1)
        # Resize to match
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
