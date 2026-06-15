feat: Initial Kinetik implementation - full-stack dating platform

Infrastructure:
- docker-compose.yml with 9 memory-limited services: PostgreSQL 16 (512MB), Redis 7 (512MB), Kafka + Zookeeper (512MB), Milvus vector DB + etcd + minio, LiveKit SFU (256MB), and 3 Node.js microservices (256MB each)
- .env.example, .gitignore, root package.json with npm workspaces

Database:
- PostgreSQL init SQL with 17 tables, enums, triggers, indexes, and 20 seed interests
- Full schema: users, profiles, preferences, flash windows, vibe_checks, matches, venues, duo_crews, subscriptions, transactions, interactions, vectors, KYC, audit log

Shared Package (@kinetik/shared):
- Complete TypeScript types for all domain models (User, VibeCheck, Match, DuoCrew, Subscription, etc.)
- Constants: Redis keys, Kafka topics, API routes, error codes, timing values, H3 config
- Utilities: haversine distance, cosine/weighted similarity, OTP/invite code generation
- Database client: connection pool, query helpers, transaction wrapper
- H3 geospatial utility wrapping h3-js v4 with geoToH3, kRing, adaptive ring radius

Core API Service (@kinetik/api-core, port 3001):
- Fastify server with JWT auth, CORS, rate limiting, error handling
- 10 route modules: auth (register/login/OTP/refresh), users (profile/preferences/location/photos),
  onboarding (step tracking), windows (join/leave), matches (list/detail), fans (blurred paywall),
  venues (nearby B2B), payments (Razorpay orders/subscriptions), duo crews (create/join),
  webhooks (Razorpay event handler)
- Kafka producer integration for event streaming
- Redis caching for presence and session state

Real-Time WebSocket Service (@kinetik/realtime, port 3002):
- Socket.IO server with JWT auth middleware
- 3 namespace handlers: flashWindow (queue management, H3 cell presence),
  vibeCheck (3-minute call lifecycle with progressive visual phases),
  presence (online/away/busy tracking with heartbeat)
- Redis Pub/Sub for cross-instance communication
- Kafka consumer for window/match/vibe events

Match Engine Service (@kinetik/match-engine, port 3003):
- BullMQ worker with exponential backoff for match processing
- VectorMatcher: weighted cosine similarity on personality vectors with value alignment,
  distance scoring, and confidence calculation
- SpatialMatcher: real h3-js kRing spatial queries with adaptive ring radius based on
  user density (Dynamic Liquidity Balancer), Redis-cached user profiles
- WindowManager: lifecycle management for flash windows (activate/close, participant pools)
- Kafka consumer for window/match/user events

React Native Mobile App (@kinetik/mobile):
- Expo SDK 51 with dark-mode theme system (colors, typography, spacing, shadows, animations)
- 4 common components: Button (6 variants), Input (with validation), Card, Avatar
- Zustand auth store with SecureStore token persistence
- REST API client with all backend endpoints
- Navigation: Stack + Bottom Tab navigator with auth guard and onboarding flow
- 24 screens across 6 modules:
  - Onboarding (6): Splash/Auth, Identity, Location Permission, Photo Upload,
    Pose Verification, KYC Document Upload
  - Preferences (4): Filter Constraints, Value Matrix, Priority Weighting,
    Communication Cadence
  - Engine (5): Flash Countdown, Active Radar, Vibe Check, Gradient Unmasking,
    Commitment Gate
  - Scheduling (4): Lock Status, Calendar Sync, B2B Venue Selector, Reservation Locker
  - Viral (3): Duo Wingman Lobby, Double Date Live Room, Local Cluster Heat Map
  - Wallet (2): Token Vault, Profile Ledger

H3 Geospatial Indexing (latest):
- Replaced simulated H3 offset matching with real h3-js v4 library
- geoToH3() at resolution 7 (~244m cells) for hyperlocal matching
- getNeighborCells() using kRing() for real hexagonal spatial queries
- getAdaptiveRingRadius() implementing the Dynamic Liquidity Balancer
  (tight radius for high-density, expanded for low-density areas)
- Updated api-core location route to store real H3 hex indices
- Updated match-engine index to pass DB pool for user detail fetching

Setup scripts:
- scripts/generate_assets.py and generate_assets.js for placeholder PNGs
- scripts/setup.bat for one-click asset generation + npm install
- metro.config.js for React Native SVG transformer support
