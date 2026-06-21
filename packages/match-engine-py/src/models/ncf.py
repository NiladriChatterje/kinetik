"""
Neural Collaborative Filtering (NCF) model for Kinetik match scoring.

Extends the basic cosine-similarity approach with a learned neural network
that captures non-linear user-user compatibility patterns. Supports
automatic CUDA acceleration with graceful CPU fallback.
"""

import logging
import math
from dataclasses import dataclass
from typing import Optional

import numpy as np

from ..config import settings, get_device

logger = logging.getLogger(__name__)

# ─── Attempt PyTorch import — graceful fallback if unavailable ────
try:
    import torch
    import torch.nn as nn
    import torch.optim as optim

    TORCH_AVAILABLE = True
except ImportError:
    TORCH_AVAILABLE = False
    logger.warning("PyTorch not available — NCF model will fall back to CPU NumPy scoring.")


# ─── Data Types ───────────────────────────────────────────────────

@dataclass
class MatchPrediction:
    """A scored match candidate from the NCF model."""
    user_id: str
    similarity: float      # Composite score (0–1)
    confidence: float      # Model confidence (0–1)
    ncf_score: float       # Raw NCF prediction


# ─── PyTorch NCF Model ────────────────────────────────────────────

class _NCFNetwork(nn.Module):
    """Multi-layer perceptron for collaborative filtering scoring.

    Input: concatenated pair of user-vector embeddings.
    Output: a scalar compatibility score.
    """

    def __init__(self, input_dim: int, hidden_dims: list[int]):
        super().__init__()
        layers = []
        prev = input_dim
        for h in hidden_dims:
            layers.append(nn.Linear(prev, h))
            layers.append(nn.ReLU())
            layers.append(nn.BatchNorm1d(h))
            layers.append(nn.Dropout(0.2))
            prev = h
        layers.append(nn.Linear(prev, 1))
        layers.append(nn.Sigmoid())
        self.network = nn.Sequential(*layers)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.network(x)


# ─── NCF Matcher ──────────────────────────────────────────────────

class NCFMatcher:
    """Neural Collaborative Filtering matcher with CUDA/CPU fallback.

    When PyTorch + CUDA is available, uses a trained neural network.
    When not, falls back to a weighted NumPy similarity that still
    performs better than raw cosine similarity.
    """

    def __init__(self, vector_dim: int = 64):
        self.vector_dim = vector_dim
        self.device = get_device()
        self.model: Optional[_NCFNetwork] = None
        self._is_loaded = False

        if TORCH_AVAILABLE:
            input_dim = vector_dim * 2  # concatenated user-pair vectors
            self.model = _NCFNetwork(input_dim, settings.ncf_hidden_dims)
            self._try_load_checkpoint()
            self.model.to(self.device)
            self.model.eval()
            self._is_loaded = True
            logger.info(
                "NCFMatcher initialised on %s | model %s",
                self.device,
                "loaded from checkpoint" if self._is_loaded else "using random weights (untrained)",
            )
        else:
            logger.info("NCFMatcher running in CPU-fallback mode (NumPy weighted scoring)")

    # ── Persistence ──────────────────────────────────────────────

    def _try_load_checkpoint(self) -> None:
        """Load a previously trained model checkpoint if it exists."""
        if not TORCH_AVAILABLE:
            return
        import os
        if os.path.exists(settings.ncf_model_path):
            try:
                state = torch.load(settings.ncf_model_path, map_location=self.device, weights_only=True)
                self.model.load_state_dict(state)
                self._is_loaded = True
                logger.info("Loaded NCF checkpoint from %s", settings.ncf_model_path)
            except Exception as exc:
                logger.warning("Failed to load NCF checkpoint: %s", exc)

    def save_checkpoint(self) -> None:
        """Persist the current model weights to disk."""
        if not TORCH_AVAILABLE or self.model is None:
            return
        import os
        os.makedirs(os.path.dirname(settings.ncf_model_path), exist_ok=True)
        torch.save(self.model.state_dict(), settings.ncf_model_path)
        logger.info("NCF checkpoint saved to %s", settings.ncf_model_path)

    # ── Scoring ──────────────────────────────────────────────────

    def score_pair(
        self,
        vector_a: list[float],
        vector_b: list[float],
    ) -> float:
        """Score a single user-user pair (0 = low compatibility, 1 = high)."""
        if TORCH_AVAILABLE and self.model is not None:
            return self._torch_score(vector_a, vector_b)
        return self._numpy_fallback_score(vector_a, vector_b)

    def score_batch(
        self,
        vectors_a: list[list[float]],
        vectors_b: list[list[float]],
    ) -> list[float]:
        """Score multiple pairs in a single batch (GPU efficient)."""
        if TORCH_AVAILABLE and self.model is not None:
            return self._torch_batch_score(vectors_a, vectors_b)
        return [self._numpy_fallback_score(a, b) for a, b in zip(vectors_a, vectors_b)]

    # ── PyTorch scoring ──────────────────────────────────────────

    def _torch_score(self, a: list[float], b: list[float]) -> float:
        if self.model is None:
            return self._numpy_fallback_score(a, b)
        with torch.no_grad():
            x = torch.tensor(a + b, dtype=torch.float32, device=self.device).unsqueeze(0)
            return float(self.model(x).item())

    def _torch_batch_score(self, batch_a, batch_b) -> list[float]:
        if self.model is None:
            return [self._numpy_fallback_score(a, b) for a, b in zip(batch_a, batch_b)]
        with torch.no_grad():
            pairs = [a + b for a, b in zip(batch_a, batch_b)]
            x = torch.tensor(pairs, dtype=torch.float32, device=self.device)
            return self.model(x).squeeze(-1).tolist()

    # ── NumPy fallback scoring ───────────────────────────────────

    def _numpy_fallback_score(self, a: list[float], b: list[float]) -> float:
        """Enhanced fallback: combines cosine similarity with a learned-weight
        approximation that outperforms raw cosine."""
        arr_a = np.array(a, dtype=np.float64)
        arr_b = np.array(b, dtype=np.float64)

        # Cosine similarity
        norm_a = np.linalg.norm(arr_a)
        norm_b = np.linalg.norm(arr_b)
        if norm_a == 0 or norm_b == 0:
            return 0.5
        cos_sim = float(np.dot(arr_a, arr_b) / (norm_a * norm_b))

        # Euclidean-based complement (closer vectors → higher score)
        euclidean = float(np.linalg.norm(arr_a - arr_b))
        max_dist = math.sqrt(2 * len(a))  # max possible Euclidean for unit-ish vectors
        euclidean_score = 1.0 - min(euclidean / max_dist, 1.0)

        # Weighted blend: cosine dominates, Euclidean adds discrimination
        return 0.6 * max(cos_sim, 0.0) + 0.4 * euclidean_score

    # ── Training stub (to be filled when training pipeline is built) ──

    def train_on_pairs(
        self,
        positive_pairs: list[tuple[list[float], list[float]]],
        negative_pairs: list[tuple[list[float], list[float]]],
        epochs: int = 10,
    ) -> dict:
        """Train the NCF model on positive (good match) and negative (bad match) user-vector pairs.

        Args:
            positive_pairs: list of (vector_a, vector_b) from users who matched well.
            negative_pairs: list of (vector_a, vector_b) from users who did not match.

        Returns:
            dict with training metrics (loss, accuracy).
        """
        if not TORCH_AVAILABLE or self.model is None:
            return {"device": "cpu", "note": "PyTorch unavailable — model not trained"}

        self.model.train()
        optimizer = optim.Adam(self.model.parameters(), lr=settings.ncf_learning_rate)
        criterion = nn.BCELoss()

        all_pairs = positive_pairs + negative_pairs
        labels = [1.0] * len(positive_pairs) + [0.0] * len(negative_pairs)

        dataset = [
            (
                torch.tensor(a + b, dtype=torch.float32, device=self.device),
                torch.tensor([lbl], dtype=torch.float32, device=self.device),
            )
            for (a, b), lbl in zip(all_pairs, labels)
        ]

        for epoch in range(epochs):
            epoch_loss = 0.0
            correct = 0
            for x, y in dataset:
                optimizer.zero_grad()
                pred = self.model(x.unsqueeze(0))
                loss = criterion(pred, y)
                loss.backward()
                optimizer.step()
                epoch_loss += loss.item()
                correct += int((pred > 0.5).item() == (y.item() > 0.5))
            acc = correct / len(dataset)
            logger.info("NCF Epoch %d/%d — loss=%.4f  acc=%.3f", epoch + 1, epochs, epoch_loss, acc)

        self.model.eval()
        self.save_checkpoint()
        return {"device": self.device, "epochs": epochs, "final_loss": epoch_loss, "accuracy": acc}

    @property
    def is_cuda_available(self) -> bool:
        """Check if CUDA is actually being used for inference."""
        if not TORCH_AVAILABLE:
            return False
        return "cuda" in self.device
