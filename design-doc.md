```markdown
# Kinetik: Product Requirement Document (PRD) & Engineering Architecture
## The Inertia-Killing Dating Network

---

## 1. Executive Summary & Market Thesis

### 1.1 The Market Pain: The Texting Black Hole
Modern dating applications (Tinder, Bumble, Hinge) are suffering from late-stage network fatigue[cite: 1]. The primary user friction point has shifted from **discovery** (finding matches) to **execution** (actually meeting them)[cite: 1]. 

This phenomenon is known as **The Texting Black Hole**:
* **High Match-to-Meet Friction:** Less than 5% of digital matches result in a first date[cite: 1].
* **Asynchronous Burnout:** Users spend days exchanging low-intent, superficial messages (*"Hey, how was your weekend?"*), leading to psychological fatigue and high app abandonment rates[cite: 1].
* **Gamerization vs. Intent:** The prevailing UX paradigms incentivize endless swiping as an entertainment loop rather than a mechanism for real-world connection[cite: 1].

### 1.2 The Value Proposition: Kinetik
**Kinetik** completely re-engineers the digital dating pipeline by eliminating asynchronous text-based stalling[cite: 1]. It replaces the infinite swiping loop with synchronous, low-friction, micro-commitments called **Vibe Checks**[cite: 1]. 


```

[Traditional Apps]  Match ──► Endless Texting ──► Ghosting / Momentum Loss
[Kinetik Pipeline]  Queue ──► 3-Min Blind Audio ──► Mutual Unlock ──► Calendar Lock

```

By concentrating user activity into structured, high-density live windows, Kinetik bridges the gap between digital discovery and physical real-world inertia[cite: 1].

---

## 2. Core User Experience & Product Mechanics

### 2.1 The Live Queue & Window Synchronization
Kinetik does not operate on a 24/7 passive swiping paradigm[cite: 1]. Instead, it utilizes **Flash Windows** to concentrate local liquidity[cite: 1].
* **The Concept:** Users opt into structured 30-minute windows (e.g., Daily at 8:30 PM - 9:00 PM, Sunday Megawindows)[cite: 1].
* **The UX:** When the window opens, users enter a live interactive queue[cite: 1]. The app UI transitions into an active, high-intent matching radar screen[cite: 1].

### 2.2 The 3-Minute Blind "Vibe Check"
When two profiles match within the live queue, the platform bypasses the chat screen entirely and initiates an instantaneous audio connection[cite: 1].
* **Visual Anonymization:** For the first 60 seconds, the screen displays a dynamic, real-time abstract silhouette or heavily blurred avatar generated from the partner's profile[cite: 1].
* **The Reveal Loop:** As the call progresses and active conversational metrics are met, the image gradually clarifies[cite: 1].
  * *0:00 - 1:00:* Complete silhouette, audio only[cite: 1].
  * *1:00 - 2:00:* High-blur image revelation (if both users maintain the connection)[cite: 1].
  * *2:00 - 3:00:* Full profile image unmasks[cite: 1].
* **The Commitment Action:** At the 3-minute mark, the call cuts off[cite: 1]. Both users have 15 seconds to tap **"Lock It In"** or **"Pass"**[cite: 1]. If mutual interest is confirmed, the app moves directly to calendar scheduling[cite: 1].

### 2.3 The Viral Engine: "The Double Date"
To drive sub-linear user acquisition costs ($0 CAC at scale), Kinetik embeds a multi-player viral loop directly into the matchmaking design[cite: 1].
* **Mechanic:** A user can invite a single friend to form a "Duo Crew"[cite: 1].
* **Execution:** The matching engine pairs two Duo Crews into a synchronized 4-person live video or audio hangout[cite: 1]. 
* **Growth Vector:** To unlock the highly popular "Double Date" queue, single users are forced to share a referral link with their single real-world friends, creating a self-sustaining organic growth engine[cite: 1].

---

## 3. High-Level Engineering Architecture

To sustain millions of concurrent, sub-second matching calculations and real-time audio/video streams, Kinetik avoids heavy, monolithic database queries in favor of a decentralized, event-driven architecture[cite: 1].

### 3.1 Structural System Diagram


```

```
             +────────────────────────┐
             │   Client Applications  │
             │   (iOS / Android React)│
             +───────────┬────────────┘
                         │
        WebSockets / HTTP│ (Real-Time Signals)
                         ▼
             +────────────────────────┐
             │  API Gateway & Routing │
             │      (Envoy Proxy)     │
             +───────────┬────────────┘
                         │
                         ├──────────────────────────────────────┐
                         ▼                                      ▼
             +───────────────────────┐              +───────────────────────┐
             │ Live Matching Cluster │              │  Signaling & State    │
             │   (Go / gRPC Pods)    │              │ (Elixir / Phoenix)    │
             +───────────┬───────────┘              +───────────┬───────────┘
                         │                                      │
     Vectors / Spatial   │                                      │ WebRTC Control
     Queries             ▼                                      ▼
+─────────────────────────────────────────+        +─────────────────────────+
│              DATA TIER                  │        │   Turn/Stun Infrastructure│
│  - Redis Enterprise (Geospatial/State)  │        │   - LiveKit / Twilio     │
│  - Milvus / Pinecone (Vector Database)  │        +─────────────────────────+
│  - PostgreSQL (Persistent User Data)   │
+─────────────────────────────────────────+

```

```

### 3.2 Core Component Breakdown

| Component | Technology Stack | Architectural Purpose |
| :--- | :--- | :--- |
| **Edge Gateway** | Envoy Proxy[cite: 1] | Manages rate limiting, SSL termination, and routes WebSocket traffic to appropriate microservices[cite: 1]. |
| **State & Presence** | Elixir & Phoenix Framework[cite: 1] | Maintains persistent open connections with millions of active app users simultaneously with minimal footprint. Handles call metadata[cite: 1]. |
| **Match Engine** | Go (Golang)[cite: 1] | High-speed, highly concurrent computation engine that handles the matchmaking pools during active Flash Windows[cite: 1]. |
| **Vector DB** | Milvus / Pinecone[cite: 1] | Stores and performs high-speed similarity scoring on high-dimensional personality profile vectors[cite: 1]. |
| **Geospatial Index** | Redis Enterprise + Uber H3[cite: 1] | Provides sub-millisecond hexagonal ring clustering to group matching queues by hyper-local physical proximity[cite: 1]. |
| **Media Layer** | WebRTC via LiveKit[cite: 1] | Orchestrates peer-to-peer audio and video rendering directly across clients to offload infrastructure bandwidth costs[cite: 1]. |

---

## 4. Proprietary Algorithms Under the Hood

### 4.1 The Dynamic Vector Clustering (DVC) Algorithm
Rather than computing massive matrix factorizations across the entire global database every night, Kinetik calculates real-time multi-dimensional vector matching inside local spatial boundaries[cite: 1].

1. **Embedding Generation:** Every profile is transformed into a continuous vector embedding $V_u$ representing psychological variables, voice cadence characteristics, and explicit preferences[cite: 1]:
   $$V_u = [w_1, w_2, w_3, \dots, w_n]$$

2. **Spatial Restriction:** The engine projects the user's location into an Uber H3 Hexagonal coordinate index at resolution level 7 ($H3_u$)[cite: 1]. The search space is bounded to immediate and neighboring hexagons[cite: 1]:
   $$\text{Search Space } S = H3_u \cup \text{kRing}(H3_u, 1)$$

3. **Cosine Similarity Maximization:** Within the spatial subset $S$, the system ranks potential pairs utilizing cosine similarity calculations over the active queue vectors[cite: 1]:
   $$\text{Similarity}(V_i, V_j) = \frac{V_i \cdot V_j}{\|V_i\| \|V_j\|}$$

```python
# Conceptual implementation of the Real-Time Vector-Spatial Match Filter
def find_live_match(user_id, user_vector, geo_coordinates, vector_index, redis_client):
    # Step 1: Resolve hyper-local spatial cluster
    h3_index = h3.geo_to_h3(geo_coordinates['lat'], geo_coordinates['lng'], resolution=7)
    nearby_hexagons = h3.k_ring(h3_index, ring_radius=1)
    
    # Step 2: Query active users in the local cache
    active_local_users = redis_client.sunion([f"queue:{h3_id}" for h3_id in nearby_hexagons])
    active_local_users.discard(user_id)
    
    if not active_local_users:
        return None  # Trigger localized heat map pooling
        
    # Step 3: Run Vector Similarity comparison over the spatial filter subset
    match_result = vector_index.query(
        vector=user_vector,
        filter={"user_id": {"$in": list(active_local_users)}},
        top_k=1,
        include_metadata=True
    )
    
    return match_result['matches'][0] if match_result['matches'] else None

```

### 4.2 The Real-Time Throttling & Liquidity Balancer

To prevent match starvation in low-density suburban areas or overwhelming choice paralysis in massive cities, the platform uses a **Dynamic Liquidity Balancer**:

* **High-Density Mode:** If a city cluster exceeds a specific threshold (e.g., >5,000 active users in a 5km radius), the algorithm tightens vector match boundaries, prioritizing highly aligned profile clusters to optimize quality.


* **Low-Density Mode:** If a local cluster drops below minimum liquidity thresholds, the engine increases its $H3 \text{ kRing}$ search radius and shifts the matching variables toward broader core compatibility vectors, maintaining consistent app engagement.



---

## 5. Monetization Strategy & System Design

Kinetik drops the traditional, predatory "Pay to Win" matching boosts in favor of **Friction-Reduction Utility Tokens**.

### 5.1 The Revenue Model

1. **The Fast-Pass Ticket:** Allows users to skip the 3-minute countdown visual blur phase and unlock full visual profiles instantly twice per Flash Window.


2. **The "Rain Check" Lock:** If a user runs out of time or cannot make an agreed-upon calendar schedule at the end of a Vibe Check, they can expend a premium credit to save the profile state for 24 hours.


3. **B2B Calendar Integrations:** Monetize the calendar booking phase by natively pulling reservation options from local high-end coffee shops, lounges, or bars directly into the scheduling UI (charging businesses a cost-per-click or reservation-booking fee).



---

## 6. Implementation & Deployment Phase Roadmap

```
[Phase 1: Alpha Core] ──► [Phase 2: Local Cluster Testing] ──► [Phase 3: Scale Launch]
 - Elixir Signaling        - Campus Beta Drops                 - Global Vector Mesh
 - WebRTC Audio Stacks      - High-Density Popups               - Dynamic Token Ledger

```

* **Phase 1: Alpha Core (Weeks 1-12):** Build out the Elixir/Phoenix state machine, establish basic WebRTC audio/video piping, and lay down the foundational vector indexing data models.


* **Phase 2: Local Cluster Testing (Weeks 13-24):** Deploy to targeted high-density micro-environments (e.g., select university campuses). Stress-test the real-time Flash Window architecture under concentrated loads.


* **Phase 3: Scale Launch (Weeks 25+):** Turn on the "Double Date" multi-player loop to trigger organic viral acquisition vectors and scale out across primary major urban markets globally.



```

```
Here is the complete catalog of UI screens required to build and scale **Kinetik**, mapped out by functional modules with their specific structural purposes.

---

## 1. Onboarding & Verification Module

| Screen Name | Component ID | Purpose & Core UX Function |
| --- | --- | --- |
| **Splash / Auth Gateway** | `SCR-ONB-001` | Core landing screen handling phone/OAuth login registration and initial secure token generation. |
| **Core Identity Setup** | `SCR-ONB-002` | Input field matrix for basic structural parameters (Legal Name, DOB, Pronouns, and Gender Identity parameters). |
| **Geospatial Permission** | `SCR-ONB-003` | System permission modal for high-precision GPS tracking required to anchor the user into an explicit Uber H3 hexagonal spatial node. |
| **Biometric Photo Upload** | `SCR-ONB-004` | Canvas interface for uploading a primary high-resolution profile portrait used to compile vector embeddings and late-stage call unmasking. |
| **3D Pose Verification** | `SCR-ONB-005` | Real-time, anti-spoofing camera UI requiring the user to mimic a randomized 3D facial motion path to confirm liveness. |
| **Secure KYC Dashboard** | `SCR-ONB-006` | Document capture scanner interface (Government ID/Passport OCR extraction) to verify genuine unique user status and prevent automated sybil network duplication. |

---

## 2. Psychometric Preferences & Vector Weighting Module

| Screen Name | Component ID | Purpose & Core UX Function |
| --- | --- | --- |
| **Hard Filter Constraints** | `SCR-PRF-001` | Boolean boundary controls defining strict, non-negotiable operational search radiuses (Absolute Age limits and Max Distance H3 rings). |
| **Value Matrix Selection** | `SCR-PRF-002` | Interactive grid of non-superficial lifestyle taxonomy anchors (e.g., career trajectory, communication frequency, values) used to generate the base psychological compatibility vector $V_u$. |
| **Priority Weighting Dial** | `SCR-PRF-003` | Slider UI permitting users to dynamically adjust variables, telling the machine learning filter which traits are "Critical Needs" vs. "Nice-to-Haves" to balance cosine similarity values. |
| **Communication Cadence Tester** | `SCR-PRF-004` | Interactive micro-prompt quiz measuring real-time text/vibe choices to establish conversational style alignment score metrics. |

---

## 3. The Live Match Engine & Active Window Module

| Screen Name | Component ID | Purpose & Core UX Function |
| --- | --- | --- |
| **Flash Window Countdown** | `SCR-ENG-001` | High-excitement, passive lobby tracking time remaining until the next hyper-dense local synchronized 30-minute matching event opens. |
| **Active Hub Radar (The Queue)** | `SCR-ENG-002` | High-fidelity interactive radar viewport tracking real-time local cluster density metrics and connection streams once checked into the live room. |
| **The Vibe Check Interface** | `SCR-ENG-003` | Split-screen active WebRTC communication deck showing a dynamic vector abstract silhouette or heavily blurred portrait alongside an active countdown timer. |
| **The Gradient Unmasking View** | `SCR-ENG-004` | Adaptive video viewport that smoothly scales picture resolution and unmasks clarity tiers based on conversational length and matching milestones. |
| **The Commitment Gate** | `SCR-ENG-005` | High-stakes, dual 15-second countdown terminal displaying two core binary choice actions: **"Lock It In"** or **"Pass"**. |

---

## 4. Post-Match Execution & Frictionless Scheduling Module

| Screen Name | Component ID | Purpose & Core UX Function |
| --- | --- | --- |
| **The Immediate Lock Status** | `SCR-SCH-001` | Double-opt-in celebratory splash validation displaying confirmation keys once a successful mutual "Lock" selection occurs. |
| **Synchronized Calendar Sync** | `SCR-SCH-002` | Agenda integration interface syncing local device schedules (Google/Apple) to display overlapping empty slots between both matched paths. |
| **B2B Venue Selector** | `SCR-SCH-003` | High-intent local point-of-interest discovery catalog serving native business-sponsored reservation cards (lounges, cafes, spots) positioned evenly between user locations. |
| **Reservation Locker** | `SCR-SCH-004` | Secure transactional window managing deposit holds or premium utility token expenditures used to finalize date slots. |

---

## 5. Multi-player Network Activation Module (Virality)

| Screen Name | Component ID | Purpose & Core UX Function |
| --- | --- | --- |
| **Duo Wingman Lobby** | `SCR-VIR-001` | Private operational staging lounge designed to send secure deep-links inviting a real-world single friend to build a shared matchmaking squad. |
| **Double Date Live Room** | `SCR-VIR-002` | Quad-split media layout UI executing synchronized peer-to-peer WebRTC video conferencing for 4-person real-time double date mixer blocks. |
| **Local Cluster Heat Map** | `SCR-VIR-003` | Visualized geographic density matrix detailing nearby high-volume consumer hotspots to motivate localized coordination loops. |

---

## 6. Premium Ledger & Account Dashboard Module

| Screen Name | Component ID | Purpose & Core UX Function |
| --- | --- | --- |
| **Utility Token Vault** | `SCR-WAL-001` | Core balance accounting terminal illustrating functional utility values (Fast Passes, Rain Checks, verified badge states). |
| **The Profile Ledger** | `SCR-WAL-002` | Clean structural dashboard displaying the current verification parameters, biological credentials, and personal text metrics. |



--------------------------------------------------------
To scale **Kinetik** to millions of concurrent users using **Node.js**, the architecture must be designed to circumvent Node’s primary limitation: its single-threaded event loop. If your system attempts to process millions of live connections, calculate vector math, and handle geographical spatial clustering on a single main thread, the event loop will block, and the application will crash.

The solution is a **decentralized, event-driven, distributed microservices architecture**.

Here is the structural blueprint and technical design for the entire platform.

---

## 1. System Topology & Request Life Cycle

The architecture isolates high-throughput, short-lived tasks (like standard API routes) from stateful, long-lived operations (like keeping WebSockets alive during a 30-minute Flash Window).

```
                      [ Client Applications ] (iOS / Android)
                                 │
            ┌────────────────────┴────────────────────┐
            │ HTTPS (REST/gRPC)                       │ WebSockets (WSS)
            ▼                                         ▼
   +─────────────────+                       +─────────────────+
   │   API Gateway   │                       │   Edge Proxy    │
   │  (Envoy/NGINX)  │                       │  (Envoy / WSS)  │
   +────────┬────────+                       +────────┬────────+
            │                                         │
            ▼ Internal Routing                        ▼ Load Balanced
   +─────────────────────────+               +─────────────────────────+
   │ Core API Cluster        │               │ Real-Time WS Cluster    │
   │ (Node.js - Fastify Pods)│               │ (Node.js - Socket.io)   │
   +────────┬────────────────+               +────────┬────────────────+
            │                                         │
            ├────────────────────┬────────────────────┤ Event Streaming
            ▼                    ▼                    ▼
   +─────────────────+  +─────────────────+  +─────────────────+
   │ Persistent DB   │  │ Cache & States  │  │ Message Broker  │
   │  (PostgreSQL)   │  │ (Redis Cluster) │  │  (Apache Kafka) │
   +─────────────────+  +─────────────────+  +────────┬────────+
                                                      │
                                                      ▼ Consume Events
                                             +─────────────────────────+
                                             │ Background Match Engine │
                                             │ (Node.js Worker Pools)  │
                                             +────────┬────────┬───────+
                                                      │        │
                                       Vector Queries │        │ WebRTC Tokens
                                                      ▼        ▼
                                             +───────────+  +───────────+
                                             │ Vector DB │  │ Media SFU │
                                             │ (Milvus)  │  │ (LiveKit) │
                                             +───────────+  +───────────+

```

### The Request Triage Layer (Ingress)

1. **Envoy Proxy / NGINX Layer:** Acts as the reverse proxy and edge gatekeeper. It terminates SSL/TLS certificates, manages global rate-limiting to block denial-of-service attempts, and intelligently splits traffic.
* Standard HTTPS traffic (profile edits, KYC checks, payments) routes to the **Core API Cluster**.
* Upgraded WebSocket requests (`wss://`) bypass the main API and map straight to the **Real-Time WS Cluster**.



---

## 2. Component Microservice Breakdown

Instead of building a single giant monolithic Node.js application, the platform is divided into domain-specific clusters wrapped in Docker containers and orchestrated by Kubernetes (EKS/GKE).

### A. Core API Cluster (Stateless)

* **Runtime Ecosystem:** Node.js execution layer wrapped in the **Fastify** framework.
* **Responsibilities:** Handshakes, handling standard CRUD data (updating photos, preference setups, verification logs, billing history), and writing directly to the persistent storage layer.
* **Design Pattern:** Complete state autonomy. These pods do not hold any user data in localized application memory, allowing Kubernetes to aggressively scale instances up or down depending on real-time CPU demands.

### B. Real-Time WS Cluster (Stateful-Edge)

* **Runtime Ecosystem:** Node.js utilizing **Socket.io** handles the real-time open socket arrays.
* **Responsibilities:** Manages the active user connections during the intense 30-minute Flash Windows. It tracks who is online, monitors the live countdown clocks, and pushes notifications directly to the device.
* **Scalability Mechanism:** Uses the **Redis Adapter Pattern**. Since individual user instances will connect across dozens of different server nodes, a shared high-speed Redis cluster handles inter-process communications (Pub/Sub), allowing a container on Node A to send a packet to a consumer whose socket connection sits on Node B.

### C. Background Match Engine (Calculations)

* **Runtime Ecosystem:** Independent Node.js processes built as **Worker Pools** or running on dedicated Kubernetes cron-pods, operating strictly off asynchronous event queues.
* **Responsibilities:** This is where the heavy, performance-killing computation lives. It pulls batches of single users who have checked into specific geographical zones, fires off requests to the vector databases, and checks compatibility criteria.
* **Isolation Strategy:** By detaching this from the API and Socket layers, if a massive calculations block experiences a bottleneck during a peak load event, the users will not get disconnected from the app, and the interface will remain fully responsive.

---

## 3. Data Tier & Processing Pipelines

A critical architecture choice for millions of users is selecting the right tool for the right data model. Kinetik implements a Polyglot Storage strategy:

### Data Partitioning Strategy

| Data Type | Performance Requirement | Selected Database Technology |
| --- | --- | --- |
| **User Profiles, Financials, Audits** | ACID Compliance, High Durability | **PostgreSQL** (with Read Replicas) |
| **Active Session State, Geo H3 Cells** | Sub-Millisecond Reads/Writes, Volatile | **Redis Cluster** (In-Memory Data Structure) |
| **Multi-Dimensional Personality Data** | High-Dimensional Nearest-Neighbor Matching | **Milvus / Pinecone** (Vector DB Engine) |

### The Real-Time Spatial Filtering Pipeline

To process matches across millions of users in real time without creating database deadlocks, the architecture relies on a **Spatial Sharding pipeline**:

```
[User App Checks In] ──► [WebSocket Pod] ──► [Write User ID to Redis H3 Cell Key]
                                                   │
                                                   ▼
[Worker Node] ◄── [Read Bulk User IDs] ◄── [Query Neighboring H3 Redis Sets]
     │
     ▼
[Send Local ID Array to Milvus Vector Database] ──► [Return Single Best Match Pair]

```

1. **Ingress Phase:** When a user opens the app during the Flash Window, the device transmits its current latitude and longitude via WebSockets.
2. **Spatial Sharding:** The WebSocket node converts the coordinates into an Uber H3 Hexagonal Cell Identifier. It stores the user's ID inside a Redis Set keyed explicitly to that specific H3 spatial cell.
3. **Queue Compaction:** The Background Match Engine queries Redis only for the contents of that explicit H3 cell and its direct geographical neighbors. This turns a multi-million user global database search into a highly isolated search containing only the few hundred local users physically next to each other.
4. **Vector Scoping:** The localized ID array is sent to the Vector Database as a strict categorical filter constraint. The database executes its high-dimensional cosine similarity search *only* on that tiny subset, ensuring calculation speeds remain consistent under high concurrent usage.

---

## 4. WebRTC Media Architecture (The 3-Minute Vibe Check)

To support millions of simultaneous live video and audio streams without going bankrupt from bandwidth and hosting infrastructure costs, the design relies on a **Decentralized Media Architecture System**.

### The Signaling vs. Media Split

* **The Signaling Plane (Node.js):** Your Node.js backend handles the orchestration layer. It negotiates connection terms, keeps track of the active 3-minute countdown timers, and generates encrypted authentication tokens. It never handles actual audio or video bits.
* **The Media Plane (LiveKit / Selective Forwarding Unit):** WebRTC connections route through a highly optimized, dedicated open-source SFU (Selective Forwarding Unit) framework like **LiveKit** or **Janus** running on bare-metal or heavy computing infrastructure.
* **Bandwidth Optimization Loop:** The client applications connect directly to the SFU to pipe their audio streams. The SFU dynamically alters stream characteristics based on instructions from the Node.js signaling tier.
* *Minute 0–1:* Node tells the SFU to only forward audio data and completely blocks video packets.
* *Minute 1–2:* Node tells the SFU to start passing video packets, but triggers an integrated client-side blurring shader wrapper.
* *Minute 3:* If mutual verification fails, Node immediately drops the WebRTC connection token on the SFU server level, terminating the stream instantly.



---

## 5. System Resilience & Scale Guardrails

1. **Decoupled Job Queues (BullMQ):** All long-running asynchronous workflows (such as running facial biometrics, sending transactional push alerts, or processing third-party venue reservations) are decoupled from the request cycle using **BullMQ** or **RabbitMQ**. If downstream processing targets experience an outage, incoming traffic stays safely backed up in the message broker until performance returns to normal.
2. **Circuit Breakers (Resilience4j / Custom Proxies):** Every connection from Node.js to an external dependency (the Vector database, KYC providers, or Apple/Google Cloud Messaging networks) is wrapped inside an architectural **Circuit Breaker Pattern**. If a service experiences latency spikes, the circuit trips immediately, serving graceful fallback data to users rather than exhausting Node’s database connection pools.
3. **The Multi-Region Cache Strategy:** The user's vector signature and match preferences are kept pre-warmed inside the global Redis cluster. When a Flash Window opens, the system avoids hitting the primary database entirely, allowing the matching services to run solely off the in-memory data store for maximum processing speed.

--------------------------------------------------------------------------

To integrate **Swipe Limits** and **"See Who Liked You" (Beeside / Fans Queue)** into your Node.js microservices architecture, you need to embed these paywalls across your **Data Storage**, **Real-Time Match Engine**, and **Razorpay Transactional Core**.

Since these features are high-throughput and checked every time a user triggers an action, you cannot rely solely on slow PostgreSQL database queries. Instead, the monetization gates are managed in **Redis** for speed, with **PostgreSQL** serving as the source of truth for billing.

---

## 1. Architectural Blueprint for Monetization Gates

```
                                [ USER ACTION ]
                        (Swipe Right / Open Fans Tab)
                                       │
                                       ▼
                             [ API GATEWAY / ENVOY ]
                                       │
                                       ▼
                           [ CORE NODE.JS / FASTIFY ]
                                       │
                ┌──────────────────────┴──────────────────────┐
                ▼                                             ▼
       [ SWIPE LIMIT GATE ]                          [ REVEAL LIKES GATE ]
  (Check Redis Daily Counter)                   (Check User Account Status Tier)
                │                                             │
      ┌─────────┴─────────┐                         ┌─────────┴─────────┐
      ▼                   ▼                         ▼                   ▼
[Under Limit]       [Limit Reached]           [Premium Tier]      [Free / Basic Tier]
 Allow Swipe        Block Swipe;              Fetch Unblurred     Apply Blur Filter;
 Update Stack       Trigger Razorpay Modal    Profiles            Serve Razorpay Paywall

```

---

## 2. Technical Implementation of the Two Monetization Features

### Feature A: Swipe Limits & Counter (The Engagement Cap)

Free users get a restricted allocation of right swipes per 24 hours (e.g., 50 swipes). When the limit hits 0, the Node.js backend intercepts the action and returns an `HTTP 402 Payment Required` status, which prompts the client app to open the Razorpay monetization checkout sheet.

* **Where it lives:** Inside your **Real-Time Node.js Service** interacting with a **Redis Cache Layer**.
* **The Mechanism:**
1. Every swipe action triggers a fast `INCR` command on a Redis key linked to the user (`user:{id}:swipes:daily`).
2. On the very first swipe of the day, Node sets an automated 24-hour expiration (`EXPIRE`) on that key.
3. If the returned increment value exceeds the free limit, Node flags the profile, blocks the matching engine from processing the swipe, and sends an event back to the user app to show the **Razorpay Premium Upgrade Canvas** (`SCR-WAL-001`).
4. Once a user pays via Razorpay and the webhook validates the payment, Node programmatically deletes the Redis limit key or changes the ceiling setting to `infinity`.



### Feature B: "See Who Swiped Right" (The Blur/Reveal Pipeline)

This is typically the highest-converting premium feature in dating networks. It requires storing incoming low-intent interactions without displaying them to the recipient unless they possess an active premium tier token or tier subscription.

* **Where it lives:** Inside your **PostgreSQL Database** (relationship ledger) and processed through a **Node.js Data Masking Middleware**.
* **The Mechanism:**
1. When User A swipes right on User B, Node writes a structural record to the relational database table `UserInteractions` with a status of `PENDING_MATCH`.
2. When User B opens their "Fans Queue" dashboard (`SCR-ENG-002`), the client hits your Node.js API (`GET /api/v1/profiles/likes-me`).
3. **The Paywall Interceptor:** The Node.js controller checks the user's account state ledger.
* **If Free:** Node fetches the profile records of the fans, but stripping away identifying metadata. It passes the images through a server-side blurring engine or instructs the UI layer to securely apply an obfuscation filter wrapper, overlaying a **Razorpay "Unlock All" Call-to-Action**.
* **If Premium:** Node skips the masking middleware entirely, allowing a clean array of profiles to pass straight to the view layer for instant, high-efficiency matching.





---

## 3. Updated Schema Architecture for Payments

To tie these systems into your existing **Razorpay Webhook Worker Engine**, your database model needs explicit billing parameters to track entitlements:

```
[User Table] ───► has_one ───► [Subscription Ledger]
                                  • tier: FREE / PREMIUM / INFINITE
                                  • swipe_allowance: Int (e.g., 50 or 99999)
                                  • expires_at: Timestamp
                                  • razorpay_subscription_id: String (Null)

```

### The Verification-to-Feature-Unlock Chain

1. When a payment event arrives from Razorpay (`payment.captured` or `subscription.activated`), your **Asynchronous Webhook Node** verifies the signature.
2. The worker updates the `Subscription Ledger` in PostgreSQL, moving the account tier status from `FREE` to `PREMIUM`.
3. The worker immediately flushes the user's active configuration limits inside the **Redis Cache Cluster**.
4. The WebSocket handler issues a silent, real-time push event to the client device, transitioning the UI instantly to remove image blurs and restore full swiping rights without requiring a clumsy manual application restart.