import { cosineSimilarity, weightedCosineSimilarity } from '@kinetik/shared';

interface UserProfileVector {
  vector: number[];
  weight_values: number;
  weight_age: number;
  weight_distance: number;
  weight_interests: number;
  age_min: number;
  age_max: number;
  max_distance_km: number;
  values_ambition: number;
  values_social: number;
  values_adventure: number;
  values_tradition: number;
  values_intellect: number;
  values_emotional: number;
}

interface NearbyUser {
  userId: string;
  vector: number[];
  latitude: number;
  longitude: number;
  age: number;
  distance_km: number;
}

interface MatchCandidate {
  userId: string;
  similarity: number;
  confidence: number;
}

export class VectorMatcher {
  /**
   * Find the best match for a user from a list of nearby users
   * using weighted cosine similarity on personality vectors
   */
  async findBestMatch(
    userProfile: UserProfileVector,
    nearbyUsers: NearbyUser[],
  ): Promise<MatchCandidate | null> {
    if (!nearbyUsers.length) return null;

    const candidates: MatchCandidate[] = nearbyUsers.map((other) => {
      // 1. Base vector similarity (personality matching)
      const vectorSimilarity = cosineSimilarity(
        userProfile.vector,
        other.vector,
      );

      // 2. Value alignment score
      const valueScore = this.calculateValueAlignment(userProfile, other);

      // 3. Distance score (closer = better)
      const distanceScore = this.calculateDistanceScore(
        other.distance_km,
        userProfile.max_distance_km,
      );

      // 4. Composite weighted score
      const compositeScore =
        vectorSimilarity * 0.4 +
        valueScore * 0.35 +
        distanceScore * 0.25;

      // Calculate confidence based on how high the score is
      const confidence = this.calculateConfidence(compositeScore);

      return {
        userId: other.userId,
        similarity: compositeScore,
        confidence,
      };
    });

    // Filter candidates with minimum threshold
    const qualified = candidates.filter(
      (c) => c.similarity >= 0.3 && c.confidence >= 0.2,
    );

    if (!qualified.length) return null;

    // Sort by similarity score descending
    qualified.sort((a, b) => b.similarity - a.similarity);

    // Add some randomness to avoid always matching the same person
    const topCandidates = qualified.slice(0, Math.min(3, qualified.length));
    const randomIndex = Math.floor(Math.random() * topCandidates.length);

    return topCandidates[randomIndex];
  }

  /**
   * Calculate how well two users' value systems align
   */
  private calculateValueAlignment(
    user: UserProfileVector,
    other: NearbyUser,
  ): number {
    const userValues = [
      user.values_ambition,
      user.values_social,
      user.values_adventure,
      user.values_tradition,
      user.values_intellect,
      user.values_emotional,
    ];

    // For the other user, we estimate from their vector (first 6 dimensions)
    const otherValues = other.vector.slice(0, 6);

    if (userValues.length !== otherValues.length) return 0.5;

    return cosineSimilarity(userValues, otherValues);
  }

  /**
   * Calculate distance score (closer = higher score)
   */
  private calculateDistanceScore(
    distanceKm: number,
    maxDistanceKm: number,
  ): number {
    if (distanceKm <= 0) return 1.0;
    if (distanceKm >= maxDistanceKm) return 0.0;

    // Inverse exponential decay
    return Math.exp(-(distanceKm / (maxDistanceKm / 3)));
  }

  /**
   * Calculate confidence level of a match
   */
  private calculateConfidence(similarity: number): number {
    // Sigmoid function to map similarity to confidence
    return 1 / (1 + Math.exp(-10 * (similarity - 0.5)));
  }
}
