import React, { useEffect, useRef, useState } from 'react';

/* ─── Kinetik Landing Page ──────────────────────────────────
   One-page SPA for Google Play / Pay Console approval.
   Scroll-scrubbing SVG animations, monochrome minimalist theme.
   ──────────────────────────────────────────────────────────── */

const SUPPORT_EMAIL = 'support@kinetik.app';
const BUSINESS_NAME = 'Kinetik';

/* ─── Utility: clamp a value between min and max ──────────── */
function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

/* ─── Hook: track scroll progress (0→1) for an element ───── */
function useScrollProgress(ref: React.RefObject<HTMLElement | null>) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        if (!ref.current) return;
        const rect = ref.current.getBoundingClientRect();
        const vh = window.innerHeight;
        // 0 = element top hits viewport bottom, 1 = element bottom hits viewport top
        const raw = 1 - rect.top / (vh + rect.height);
        setProgress(clamp(raw, 0, 1));
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, [ref]);

  return progress;
}

/* ─── Hook: IntersectionObserver "in view" flag ──────────── */
function useInView(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisible(true); },
      { threshold },
    );
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [threshold]);

  return { ref, visible };
}

/* ─── SVG: Hero radar pulse ──────────────────────────────── */
function HeroRadarSVG() {
  const sectionRef = useRef<HTMLElement>(null);
  const [angle, setAngle] = useState(0);
  const [pulseScale, setPulseScale] = useState(1);

  useEffect(() => {
    let frame: number;
    const start = performance.now();
    const animate = (now: number) => {
      const elapsed = (now - start) / 1000;
      setAngle(elapsed * 60); // 60 degrees per second
      setPulseScale(1 + Math.sin(elapsed * 1.5) * 0.08);
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, []);

  const sweepAngle = angle;

  return (
    <section className="hero" id="top" ref={sectionRef}>
      <div className="hero-radar-wrap">
        <svg
          className="hero-radar"
          viewBox="0 0 400 400"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Concentric rings */}
          {[1, 2, 3, 4].map((i) => (
            <circle
              key={i}
              cx="200"
              cy="200"
              r={i * 40}
              stroke="var(--primary)"
              strokeWidth="1"
              opacity={0.08 + i * 0.04}
            />
          ))}
          {/* Sweep line */}
          <line
            x1="200"
            y1="200"
            x2={200 + 160 * Math.cos((sweepAngle * Math.PI) / 180)}
            y2={200 + 160 * Math.sin((sweepAngle * Math.PI) / 180)}
            stroke="var(--primary)"
            strokeWidth="1.5"
            opacity="0.4"
          />
          {/* Sweep arc (the "trail") */}
          <path
            d={`M 200 200 L ${200 + 160 * Math.cos(((sweepAngle - 40) * Math.PI) / 180)} ${200 + 160 * Math.sin(((sweepAngle - 40) * Math.PI) / 180)} A 160 160 0 0 1 ${200 + 160 * Math.cos((sweepAngle * Math.PI) / 180)} ${200 + 160 * Math.sin((sweepAngle * Math.PI) / 180)} Z`}
            fill="var(--primary)"
            opacity="0.06"
          />
          {/* Radar blips */}
          {[
            { x: 240, y: 150, r: 4 },
            { x: 170, y: 120, r: 3 },
            { x: 280, y: 220, r: 3.5 },
            { x: 150, y: 260, r: 3 },
            { x: 220, y: 290, r: 4 },
          ].map((blip, i) => {
            const blipVisible = sweepAngle % 360 > (i * 72);
            return (
              <circle
                key={i}
                cx={blip.x}
                cy={blip.y}
                r={blip.r * pulseScale}
                fill="var(--primary)"
                opacity={blipVisible ? 0.6 : 0.15}
              />
            );
          })}
          {/* Center dot */}
          <circle cx="200" cy="200" r="4" fill="var(--primary)" />
        </svg>
      </div>
      <div className="container">
        <span className="hero-badge">THE INERTIA-KILLING DATING NETWORK</span>
        <h1>
          Match. Move.
          <br />
          Make it messy.
        </h1>
        <p>
          Kinetik replaces the infinite swiping loop with 3-minute voice Vibe Checks.
          Real voices. Real chemistry. Real dates — not another dead chat thread.
        </p>
        <div className="hero-actions">
          <a href="#how-it-works" className="btn btn-primary">
            See how it works
          </a>
          <a href="#premium" className="btn btn-outline">
            Go Premium — ₹149/mo
          </a>
        </div>
      </div>
    </section>
  );
}

/* ─── SVG: The Texting Black Hole ────────────────────────── */
function BlackHoleSVG() {
  const ref = useRef<HTMLElement>(null);
  const progress = useScrollProgress(ref);
  const spiralRotation = progress * 360;
  const spiralScale = 0.6 + progress * 0.4;

  return (
    <section className="section section-dark" id="problem" ref={ref}>
      <div className="container split-layout">
        <div className="split-text">
          <span className="section-label">THE PROBLEM</span>
          <h2>The texting black hole</h2>
          <p>
            Modern dating apps are broken. Less than 5% of matches ever result in a first date.
            You match, you exchange "hey how was your weekend," and then — nothing.
            Momentum dies. Ghosting wins.
          </p>
          <p className="stat-highlight">
            <strong>95%</strong> of digital matches never become real-world meetings.
          </p>
        </div>
        <div className="split-visual">
          <svg viewBox="0 0 300 300" className="scroll-svg" fill="none">
            {/* Spiral that tightens as you scroll */}
            <g transform={`translate(150,150) rotate(${spiralRotation}) scale(${spiralScale})`}>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <circle
                  key={i}
                  cx="0"
                  cy="0"
                  r={130 - i * 18}
                  stroke="var(--primary)"
                  strokeWidth="1"
                  opacity={0.15 - i * 0.02}
                  strokeDasharray={`${4 + i * 2} ${8 + i * 3}`}
                />
              ))}
              {/* Messages spiraling in */}
              {["hey", "u up?", "lol", "...", "nm", "k"].map((msg, i) => {
                const angle = (i * 60 + spiralRotation * 0.5) * (Math.PI / 180);
                const radius = 110 - i * 14;
                return (
                  <text
                    key={i}
                    x={Math.cos(angle) * radius}
                    y={Math.sin(angle) * radius}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill="var(--primary)"
                    fontSize="11"
                    opacity={0.3 + progress * 0.4}
                    fontFamily="var(--font)"
                  >
                    {msg}
                  </text>
                );
              })}
              <circle cx="0" cy="0" r="6" fill="var(--primary)" opacity="0.5" />
            </g>
          </svg>
        </div>
      </div>
    </section>
  );
}

/* ─── SVG: How It Works — Pipeline ───────────────────────── */
const STEPS = [
  {
    num: '01',
    title: 'Flash Windows',
    body: 'At 8:30 PM every day, Kinetik opens a 30-minute matching window in your area. Everyone checks in at once — maximum local density, maximum intent.',
  },
  {
    num: '02',
    title: '3-Minute Vibe Check',
    body: 'No photos. No profiles. Just a blind audio call. For the first 60 seconds you hear only a voice. Then the image gradually unblurs. Chemistry before judgment.',
  },
  {
    num: '03',
    title: 'Lock It In',
    body: 'After 3 minutes, both of you choose: "Lock It In" or "Pass." If it\'s mutual — straight to scheduling a real date. No texting. No ghosting. Just a plan.',
  },
];

function PipelineSVG() {
  const ref = useRef<HTMLElement>(null);
  const progress = useScrollProgress(ref);
  const lineProgress = clamp((progress - 0.1) / 0.6, 0, 1);

  return (
    <section className="section" id="how-it-works" ref={ref}>
      <div className="container">
        <span className="section-label">HOW IT WORKS</span>
        <h2 className="section-title">Three steps to a real date</h2>
        <p className="section-sub">
          No profiles to agonize over. No messages to craft. Just show up, talk, and decide.
        </p>

        <div className="pipeline">
          {/* Connecting line */}
          <div className="pipeline-line">
            <div
              className="pipeline-line-fill"
              style={{ height: `${lineProgress * 100}%` }}
            />
          </div>

          {STEPS.map((step, i) => {
            const stepVisible = progress > 0.15 + i * 0.2;
            return (
              <div
                key={step.num}
                className={`pipeline-step ${stepVisible ? 'visible' : ''}`}
              >
                <div className="pipeline-dot">
                  <span>{step.num}</span>
                </div>
                <div className="pipeline-content">
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Animated SVG illustrating the pipeline */}
        <div className="pipeline-visual">
          <svg viewBox="0 0 800 120" className="pipeline-svg" fill="none">
            {/* Three phases */}
            {/* Phase 1: Radar / Queue */}
            <g opacity={clamp((progress - 0.1) / 0.2, 0, 1)}>
              <circle cx="130" cy="60" r="40" stroke="var(--primary)" strokeWidth="1.5" opacity="0.3" />
              <circle cx="130" cy="60" r="25" stroke="var(--primary)" strokeWidth="1" opacity="0.2" />
              <circle cx="130" cy="60" r="10" stroke="var(--primary)" strokeWidth="1" opacity="0.15" />
              {/* Sweep */}
              <line
                x1="130"
                y1="60"
                x2={130 + 40 * Math.cos(progress * 8)}
                y2={60 + 40 * Math.sin(progress * 8)}
                stroke="var(--primary)"
                strokeWidth="1.5"
                opacity="0.5"
              />
              <circle cx="130" cy="60" r="3" fill="var(--primary)" />
              <text x="130" y="115" textAnchor="middle" fill="var(--secondary)" fontSize="12" fontFamily="var(--font)">
                Flash Window
              </text>
            </g>

            {/* Arrow 1→2 */}
            <g opacity={clamp((progress - 0.3) / 0.15, 0, 1)}>
              <line x1="200" y1="60" x2="290" y2="60" stroke="var(--primary)" strokeWidth="1.5" strokeDasharray="4 4" />
              <polygon points="290,55 300,60 290,65" fill="var(--primary)" opacity="0.5" />
            </g>

            {/* Phase 2: Vibe Check — silhouette to reveal */}
            <g opacity={clamp((progress - 0.35) / 0.2, 0, 1)}>
              <rect x="340" y="20" width="80" height="80" rx="16" stroke="var(--primary)" strokeWidth="1.5" opacity="0.3" />
              {/* Silhouette head */}
              <circle
                cx="380"
                cy="48"
                r="14"
                fill="var(--primary)"
                opacity={0.1 + clamp((progress - 0.4) / 0.3, 0, 1) * 0.5}
              />
              {/* Silhouette body */}
              <ellipse
                cx="380"
                cy="80"
                rx="20"
                ry="12"
                fill="var(--primary)"
                opacity={0.08 + clamp((progress - 0.4) / 0.3, 0, 1) * 0.4}
              />
              {/* Blur overlay decreases */}
              <rect
                x="340"
                y="20"
                width="80"
                height="80"
                rx="16"
                fill="var(--background)"
                opacity={clamp(0.7 - (progress - 0.35) * 2, 0, 0.7)}
              />
              <text x="380" y="115" textAnchor="middle" fill="var(--secondary)" fontSize="12" fontFamily="var(--font)">
                Vibe Check
              </text>
            </g>

            {/* Arrow 2→3 */}
            <g opacity={clamp((progress - 0.55) / 0.15, 0, 1)}>
              <line x1="460" y1="60" x2="540" y2="60" stroke="var(--primary)" strokeWidth="1.5" strokeDasharray="4 4" />
              <polygon points="540,55 550,60 540,65" fill="var(--primary)" opacity="0.5" />
            </g>

            {/* Phase 3: Lock It In — calendar/lock */}
            <g opacity={clamp((progress - 0.6) / 0.2, 0, 1)}>
              <rect x="590" y="20" width="80" height="80" rx="16" stroke="var(--primary)" strokeWidth="1.5" opacity="0.3" />
              {/* Lock icon */}
              <rect
                x="615"
                y="52"
                width="30"
                height="24"
                rx="4"
                fill="var(--primary)"
                opacity={0.15 + clamp((progress - 0.65) / 0.2, 0, 1) * 0.45}
              />
              <path
                d="M 624 52 V 44 A 16 16 0 0 1 636 44 V 52"
                stroke="var(--primary)"
                strokeWidth="2.5"
                fill="none"
                opacity={0.2 + clamp((progress - 0.65) / 0.2, 0, 1) * 0.5}
              />
              <text x="630" y="115" textAnchor="middle" fill="var(--secondary)" fontSize="12" fontFamily="var(--font)">
                Lock It In
              </text>
            </g>
          </svg>
        </div>
      </div>
    </section>
  );
}

/* ─── SVG: Vibe Check Reveal animation ───────────────────── */
function VibeCheckSVG() {
  const ref = useRef<HTMLElement>(null);
  const progress = useScrollProgress(ref);
  const reveal = clamp((progress - 0.15) / 0.5, 0, 1);
  const silhouetteOpacity = 1 - reveal * 0.7;
  const faceOpacity = reveal;

  return (
    <section className="section section-alt" id="vibe-check" ref={ref}>
      <div className="container split-layout reverse">
        <div className="split-text">
          <span className="section-label">THE VIBE CHECK</span>
          <h2>Heard first. Seen second.</h2>
          <p>
            For the first 60 seconds, it's audio only — a dark silhouette on screen.
            You listen to a voice, not judge a photo. Then the image gradually unblurs.
            By minute three, you know exactly who you're talking to.
          </p>
          <div className="phase-indicators">
            <div className={`phase-dot ${progress > 0.2 ? 'active' : ''}`}>
              <span>0:00</span>
              <small>Audio only</small>
            </div>
            <div className={`phase-dot ${progress > 0.45 ? 'active' : ''}`}>
              <span>1:00</span>
              <small>Blur clears</small>
            </div>
            <div className={`phase-dot ${progress > 0.7 ? 'active' : ''}`}>
              <span>2:00</span>
              <small>Full reveal</small>
            </div>
          </div>
        </div>
        <div className="split-visual">
          <svg viewBox="0 0 300 380" className="vibe-check-svg" fill="none">
            {/* Phone frame */}
            <rect x="50" y="20" width="200" height="340" rx="28" stroke="var(--primary)" strokeWidth="2" opacity="0.2" />
            <rect x="58" y="28" width="184" height="324" rx="22" fill="var(--surface)" />

            {/* Timer */}
            <text x="150" y="60" textAnchor="middle" fill="var(--primary)" fontSize="14" fontFamily="var(--font)" fontWeight="700" opacity="0.6">
              {Math.floor(clamp(progress * 3, 0, 3))}:{String(Math.floor((clamp(progress * 3, 0, 3) % 1) * 60)).padStart(2, '0')}
            </text>

            {/* Silhouette (fades out) */}
            <g opacity={silhouetteOpacity}>
              <circle cx="150" cy="160" r="50" fill="var(--primary)" opacity="0.12" />
              <ellipse cx="150" cy="240" rx="55" ry="40" fill="var(--primary)" opacity="0.08" />
              {/* Animated pulse ring */}
              <circle
                cx="150"
                cy="160"
                r={55 + progress * 20}
                stroke="var(--primary)"
                strokeWidth="1"
                opacity={0.15 - progress * 0.1}
              />
            </g>

            {/* Revealed face (fades in) */}
            <g opacity={faceOpacity}>
              <circle cx="150" cy="155" r="45" fill="var(--primary)" opacity="0.2" />
              {/* Simple face features */}
              <circle cx="137" cy="148" r="3" fill="var(--primary)" opacity="0.4" />
              <circle cx="163" cy="148" r="3" fill="var(--primary)" opacity="0.4" />
              <path d="M 140 165 Q 150 175 160 165" stroke="var(--primary)" strokeWidth="2" fill="none" opacity="0.3" />
              {/* Hair */}
              <path d="M 105 145 Q 110 100 150 95 Q 190 100 195 145" stroke="var(--primary)" strokeWidth="2.5" fill="none" opacity="0.25" />
            </g>

            {/* Phase dots */}
            <circle cx="125" cy="310" r="5" fill={progress > 0.2 ? 'var(--primary)' : 'var(--surface-highlight)'} />
            <circle cx="150" cy="310" r="5" fill={progress > 0.45 ? 'var(--primary)' : 'var(--surface-highlight)'} />
            <circle cx="175" cy="310" r="5" fill={progress > 0.7 ? 'var(--primary)' : 'var(--surface-highlight)'} />

            {/* Labels */}
            <text x="150" y="345" textAnchor="middle" fill="var(--secondary)" fontSize="11" fontFamily="var(--font)">
              {progress < 0.25 ? 'Audio only' : progress < 0.55 ? 'Revealing...' : progress < 0.75 ? 'Almost there...' : 'Full reveal'}
            </text>
          </svg>
        </div>
      </div>
    </section>
  );
}

/* ─── SVG: Community dots converging ─────────────────────── */
function CommunitySVG() {
  const ref = useRef<HTMLElement>(null);
  const progress = useScrollProgress(ref);
  const converge = clamp((progress - 0.2) / 0.5, 0, 1);

  // Generate deterministic "random" positions
  const dots = Array.from({ length: 24 }, (_, i) => {
    const angle = (i / 24) * Math.PI * 2;
    const spreadRadius = 80 + (i % 3) * 20;
    return {
      startX: 200 + Math.cos(angle) * spreadRadius,
      startY: 200 + Math.sin(angle) * spreadRadius,
      endX: 200 + Math.cos(angle) * (20 + (i % 4) * 8),
      endY: 200 + Math.sin(angle) * (20 + (i % 4) * 8),
      r: 3 + (i % 3),
    };
  });

  return (
    <section className="section" id="community" ref={ref}>
      <div className="container center-text">
        <span className="section-label">LOCAL INTENT</span>
        <h2 className="section-title">Everyone checks in at once</h2>
        <p className="section-sub">
          Flash Windows concentrate your entire local dating pool into a 30-minute window.
          Maximum people. Maximum intent. No dead profiles.
        </p>
        <div className="community-visual">
          <svg viewBox="0 0 400 400" className="community-svg" fill="none">
            {/* Outer ring */}
            <circle cx="200" cy="200" r="180" stroke="var(--primary)" strokeWidth="0.5" opacity="0.1" />
            <circle cx="200" cy="200" r="120" stroke="var(--primary)" strokeWidth="0.5" opacity="0.08" />
            <circle cx="200" cy="200" r="60" stroke="var(--primary)" strokeWidth="0.5" opacity="0.06" />
            {/* Dots converging */}
            {dots.map((dot, i) => (
              <circle
                key={i}
                cx={dot.startX + (dot.endX - dot.startX) * converge}
                cy={dot.startY + (dot.endY - dot.startY) * converge}
                r={dot.r}
                fill="var(--primary)"
                opacity={0.15 + converge * 0.35}
              />
            ))}
            {/* Center label */}
            <text x="200" y="200" textAnchor="middle" dominantBaseline="middle" fill="var(--primary)" fontSize="13" fontWeight="700" fontFamily="var(--font)" opacity={converge * 0.7}>
              8:30 PM
            </text>
          </svg>
        </div>
      </div>
    </section>
  );
}

/* ─── Features Grid ──────────────────────────────────────── */
const FEATURES = [
  {
    icon: '🎙',
    title: 'Audio-first Vibe Checks',
    body: 'No photos upfront. Three minutes of real conversation. Chemistry before appearance.',
  },
  {
    icon: '⚡',
    title: 'Flash Windows',
    body: 'Daily 30-minute windows at 8:30 PM. Everyone checks in at once for maximum local matches.',
  },
  {
    icon: '🔒',
    title: 'Verified profiles only',
    body: 'Photo + liveness + government ID verification. Every person you meet is who they say they are.',
  },
  {
    icon: '👤',
    title: 'See who liked you',
    body: 'No blur, no guessing. See exactly who has already liked your profile and match instantly.',
  },
  {
    icon: '👥',
    title: 'Duo Crew',
    body: 'Bring a single friend. Two Duo Crews get paired for a double date hangout. Dates are better with friends.',
  },
  {
    icon: '∞',
    title: 'Unlimited swipes (Premium)',
    body: 'Premium members never hit a swipe limit. Explore every profile, every day.',
  },
];

function Features() {
  const { ref, visible } = useInView(0.1);
  return (
    <section className="section section-alt" id="features" ref={ref}>
      <div className="container">
        <span className="section-label">FEATURES</span>
        <h2 className="section-title">Built for meeting, not messaging</h2>
        <p className="section-sub">
          Every feature is designed around one idea: spend less time swiping, more time meeting someone real.
        </p>
        <div className={`grid stagger ${visible ? 'visible' : ''}`}>
          {FEATURES.map((f, i) => (
            <div className="card" key={f.title} style={{ animationDelay: `${i * 0.08}s` }}>
              <div className="card-icon">{f.icon}</div>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── Premium Pricing ────────────────────────────────────── */
const PREMIUM_FEATURES = [
  'Unlimited daily swipes',
  '25 Super Likes every day',
  'See who liked you — no blur',
  'Priority placement in discovery',
  'Cancel any time, from the app or Google Pay',
];

function Premium() {
  const { ref, visible } = useInView(0.15);
  return (
    <section className="section" id="premium" ref={ref}>
      <div className="container">
        <span className="section-label">PRICING</span>
        <h2 className="section-title">One simple plan</h2>
        <p className="section-sub">
          Billed monthly through Google Pay. Cancel whenever you like.
        </p>
        <div className={`pricing-card ${visible ? 'visible' : ''}`}>
          <span className="pricing-badge">PREMIUM</span>
          <div className="pricing-price">₹149</div>
          <div className="pricing-period">per month · recurring</div>
          <ul className="pricing-list">
            {PREMIUM_FEATURES.map((f) => (
              <li key={f}>
                <span className="check">✓</span>
                {f}
              </li>
            ))}
          </ul>
          <a href="#support" className="btn" style={{ background: '#fff', color: '#000' }}>
            Questions? Contact support
          </a>
          <p className="pricing-note">
            You approve a recurring autopay mandate once; ₹149 is charged each month and Google Pay
            notifies you before every charge. Cancel any time — Premium stays active until the end
            of the paid cycle.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ─── Support ────────────────────────────────────────────── */
function Support() {
  const { ref, visible } = useInView(0.1);
  return (
    <section className="section section-alt" id="support" ref={ref}>
      <div className="container">
        <span className="section-label">SUPPORT</span>
        <h2 className="section-title">Customer support</h2>
        <p className="section-sub">
          Payment, account, or safety concern? We respond to every query within{' '}
          <strong>48 hours</strong>, and payment issues within <strong>24 hours</strong>.
        </p>
        <div className={`support-grid stagger ${visible ? 'visible' : ''}`}>
          <div className="support-card" style={{ animationDelay: '0s' }}>
            <div className="label">EMAIL US</div>
            <div className="value">
              <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
            </div>
          </div>
          <div className="support-card" style={{ animationDelay: '0.08s' }}>
            <div className="label">IN THE APP</div>
            <div className="value">
              Profile → Settings → Help &amp; Support
            </div>
          </div>
          <div className="support-card" style={{ animationDelay: '0.16s' }}>
            <div className="label">BILLING HELP</div>
            <div className="value">
              For charges from {BUSINESS_NAME} Premium, include your Google Pay transaction ID
              when you write to us.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── Refunds & Cancellation ─────────────────────────────── */
function Refunds() {
  return (
    <section className="section" id="refunds">
      <div className="container">
        <span className="section-label">POLICY</span>
        <h2 className="section-title">Refunds &amp; cancellation policy</h2>
        <div className="prose">
          <h3>Cancelling your subscription</h3>
          <p>
            You can cancel Kinetik Premium at any time, two ways:
          </p>
          <ul>
            <li>
              <strong>Inside the Kinetik app:</strong> Subscription → Cancel subscription. Your
              Premium stays active until the end of the period you already paid for, and it will
              not renew.
            </li>
            <li>
              <strong>From Google Pay:</strong> open Google Pay → your Kinetik mandate → manage or
              cancel the recurring payment.
            </li>
          </ul>
          <p>
            Cancelling stops all future charges immediately. We never charge after cancellation.
            Deleting your Kinetik account also cancels the mandate automatically.
          </p>

          <h3>Refunds</h3>
          <p>
            Because Premium is a digital subscription delivered instantly, payments for the current
            billing cycle are <strong>non-refundable</strong> once the cycle has started — you keep
            full Premium access until the cycle ends.
          </p>
          <p>
            We will refund in full, regardless of cycle status, when:
          </p>
          <ul>
            <li>You were charged after you already cancelled (a billing error on our side);</li>
            <li>You were charged more than once for the same cycle (duplicate charge);</li>
            <li>
              You were charged without an active mandate or without your authorisation; or
            </li>
            <li>The service was materially unavailable for the entire billing cycle.</li>
          </ul>
          <p>
            To request a refund, email{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> with your transaction ID and
            the date of the charge. Approved refunds are processed within{' '}
            <strong>5–7 business days</strong> to the original payment method.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ─── Terms of Service ───────────────────────────────────── */
function Terms() {
  return (
    <section className="section section-alt" id="terms">
      <div className="container">
        <span className="section-label">LEGAL</span>
        <h2 className="section-title">Terms of service — summary</h2>
        <div className="prose">
          <p>
            By creating a Kinetik account you agree to the terms below. The full terms are
            available in-app; this summary covers the points most relevant to subscribers.
          </p>
          <h3>Eligibility</h3>
          <p>
            You must be at least 18 years old to use Kinetik. Accounts are verified with photo and
            liveness checks; impersonation and fake profiles are removed without notice.
          </p>
          <h3>Premium subscription</h3>
          <ul>
            <li>
              Premium costs <strong>₹149 per month</strong>, billed in advance through Google Pay
              as a recurring autopay mandate you authorise at signup.
            </li>
            <li>
              Each renewal grants one month of Premium features. Prices may change with 30 days'
              notice before your next renewal.
            </li>
            <li>
              Premium benefits are personal to your account and are not transferable.
            </li>
          </ul>
          <h3>Acceptable use</h3>
          <p>
            Harassment, hate speech, nudity in profile photos, spam, and commercial solicitation
            are prohibited. Violations can lead to suspension without refund for the current cycle.
          </p>
          <h3>Your data</h3>
          <p>
            We collect only what is needed to run the service (profile, photos, preferences,
            device and payment status). We never sell personal data. You can request deletion at
            any time — deleting your account removes your data and cancels your subscription and
            payment mandate automatically.
          </p>
          <h3>Contact</h3>
          <p>
            Questions about these terms: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ─── Footer ─────────────────────────────────────────────── */
function Footer() {
  return (
    <footer className="footer">
      <div className="container footer-inner">
        <span>
          © {new Date().getFullYear()} {BUSINESS_NAME}. All rights reserved.
        </span>
        <div className="footer-links">
          <a href="#features">Features</a>
          <a href="#premium">Premium</a>
          <a href="#support">Support</a>
          <a href="#refunds">Refunds &amp; Cancellation</a>
          <a href="#terms">Terms</a>
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
        </div>
      </div>
    </footer>
  );
}

/* ─── Main App ───────────────────────────────────────────── */
export default function App() {
  return (
    <>
      <Header />
      <main>
        <HeroRadarSVG />
        <BlackHoleSVG />
        <PipelineSVG />
        <VibeCheckSVG />
        <CommunitySVG />
        <Features />
        <Premium />
        <Support />
        <Refunds />
        <Terms />
      </main>
      <Footer />
    </>
  );
}

/* ─── Header ─────────────────────────────────────────────── */
function Header() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className={`header ${scrolled ? 'scrolled' : ''}`}>
      <div className="container header-inner">
        <a href="#top" className="logo">
          <span className="logo-mark">K</span>
          {BUSINESS_NAME}
        </a>
        <nav className="nav">
          <a href="#how-it-works">How It Works</a>
          <a href="#features">Features</a>
          <a href="#premium">Premium</a>
          <a href="#support">Support</a>
          <a href="#refunds">Refunds</a>
          <a href="#terms">Terms</a>
        </nav>
      </div>
    </header>
  );
}
