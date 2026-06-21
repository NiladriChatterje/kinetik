"""
Vector matcher — combines cosine similarity with the NCF neural model
for high-quality user-user match scoring.

In low-density or cold-start scenarios it falls back to pure cosine + value alignment.
"""

import logging
import math
import random
from dataclasses import dataclass
from typing import Optional

import numpy as np

from ..config import settings
from ..models.ncf import NCFMatcher
from .spatial import NearbyUser

logger = logging.getLogger(__name__)


@dataclass
class MatchCandidate:
    """A scored candidate returned by the matcher."""
    user_id: str
    similarity: float
    confidence: float


@dataclass
class UserProfileVector:
    """User profile and preference data needed for matching."""
    vector: list[float]
    weight_values: float = 0.3
    weight_age: float = 0.15
    weight_distance: float = 0.15
    weight_interests: float = 0.2
    age_min: int = 18
    age_max: int = 60
    max_distance_km: float = 50.0
    values_ambition: float = 0.5
    values_social: float = 0.5
    values_adventure: float = 0.5
    values_tradition: float = 0.5
    values_intellect: float = 0.5
    values_emotional: float = 0.5


class VectorMatcher:
    """Enhanced vector matcher using NCF neural scoring with fallback.

    When the NCF model is available (PyTorch + optionally CUDA), it uses
    the neural network for pair scoring. Otherwise falls back to a weighted
    composite of cosine similarity, value alignment, and distance scoring.
    """

    def __init__(self, vector_dim: int = 64):
        self.ncf = NCFMatcher(vector_dim=vector_dim)
        logger.info(
            "VectorMatcher initialised (NCF on %s%s)",
            self.ncf.device,
            " [CUDA]" if self.ncf.is_cuda_available else "",
        )

    # ── Public API ──────────────────────────────────────────────

    async def find_best_match(
        self,
        user_profile: UserProfileVector,
        nearby_users: list[NearbyUser],
    ) -> Optional[MatchCandidate]:
        """Find the best match for a user from a list of nearby users.

        Uses NCF neural scoring when available, otherwise falls back to
        the weighted composite scoring used in the original TypeScript engine.
        """
        if not nearby_users:
            return None

        candidates: list[MatchCandidate] = []

        for other in nearby_users:
            # 1. NCF / cosine similarity
            similarity = self.ncf.score_pair(user_profile.vector, other.vector)

            # 2. Value alignment
            value_score = self._calculate_value_alignment(user_profile, other)

            # 3. Distance score
            distance_score = self._calculate_distance_score(
                other.distance_km, user_profile.max_distance_km,
            )

            # 4. Composite weighted score
            # Use NCF-heavy weighting when available, otherwise balance
            composite = (
                similarity * 0.40
                + value_score * 0.35
                + distance_score * 0.25
            )

            confidence = self._sigmoid_confidence(composite)

            candidates.append(MatchCandidate(
                user_id=other.user_id,
                similarity=composite,
                confidence=confidence,
            ))

        # Filter by threshold
        qualified = [
            c for c in candidates
            if c.similarity >= settings.min_similarity_threshold
            and c.confidence >= settings.min_confidence_threshold
        ]

        if not qualified:
            return None

        # Sort descending by similarity
        qualified.sort(key=lambda c: c.similarity, reverse=True)

        # Add stochastic exploration among top-3 to avoid always matching the same person
        top = qualified[:min(3, len(qualified))]
        return random.choice(top)

    # ── Scoring helpers ──────────────────────────────────────────

    def _calculate_value_alignment(
        self,
        user: UserProfileVector,
        other: NearbyUser,
    ) -> float:
        """Cosine similarity between user's explicit values and the other user's vector."""
        user_values = np.array([
            user.values_ambition,
            user.values_social,
            user.values_adventure,
            user.values_tradition,
            user.values_intellect,
            user.values_emotional,
        ], dtype=np.float64)

        # First 6 dims of the other user's vector represent value alignment
        other_values = np.array(other.vector[:6], dtype=np.float64)

        u_norm = np.linalg.norm(user_values)
        o_norm = np.linalg.norm(other_values)
        if u_norm == 0 or o_norm == 0:
            return 0.5
        return float(np.dot(user_values, other_values) / (u_norm * o_norm))

    @staticmethod
    def _calculate_distance_score(distance_km: float, max_distance_km: float) -> float:
        """Score based on distance — closer is better (inverse exponential decay)."""
        if distance_km <= 0:
            return 1.0
        if distance_km >= max_distance_km:
            return 0.0
        return math.exp(-(distance_km / (max_distance_km / 3)))

    @staticmethod
    def _sigmoid_confidence(similarity: float) -> float:
        """Map a similarity score to a confidence using a sigmoid function.
        Centers around 0.5, so scores > 0.5 get high confidence, < 0.5 get low.
        """
        return 1.0 / (1.0 + math.exp(-10.0 * (similarity - 0.5)))
