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
          A verified dating app that gets you from swipe to date.
          Real profiles, real chats, real plans — with an AI that helps you say the right thing.
        </p>
        <div className="hero-actions">
          <a href="#how-it-works" className="btn btn-primary">
            See how it works
          </a>
          <a href="#premium" className="btn btn-outline">
            Go Premium — ₹149/mo
          </a>
        </div>
        <div className="hero-free-tier">
          <span className="free-badge">FREE</span>
          30 swipes &middot; 3 chats — then upgrade to Premium to unlock
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
                    fontSize="16"
                    fontWeight="600"
                    opacity={0.45 + progress * 0.45}
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
    title: 'Explore',
    body: 'Browse a gallery of verified profiles in your area. Real photos, real people, no bots.',
  },
  {
    num: '02',
    title: 'Swipe & Match',
    body: 'Like what you see? Swipe right. When it\'s mutual, you match instantly — no waiting, no guessing.',
  },
  {
    num: '03',
    title: 'Chat',
    body: 'Start a real conversation. Real-time messaging with read receipts, typing indicators, and push notifications.',
  },
  {
    num: '04',
    title: 'Meet',
    body: 'Make a plan and actually go. Kinetik is built to get you offline — not keep you swiping.',
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
        <h2 className="section-title">From swipe to date</h2>
        <p className="section-sub">
          No endless loops. No dead-end chats. Just a straight path from discovery to real life.
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
            {/* Phase 1: Explore gallery grid */}
            <g opacity={clamp((progress - 0.1) / 0.2, 0, 1)}>
              {/* Grid of profile cards */}
              <rect x="100" y="25" width="24" height="30" rx="4" stroke="var(--primary)" strokeWidth="1.5" opacity="0.3" />
              <rect x="128" y="25" width="24" height="30" rx="4" stroke="var(--primary)" strokeWidth="1.5" opacity="0.3" />
              <rect x="100" y="59" width="24" height="30" rx="4" stroke="var(--primary)" strokeWidth="1.5" opacity="0.3" />
              <rect x="128" y="59" width="24" height="30" rx="4" stroke="var(--primary)" strokeWidth="1.5" opacity="0.3" />
              {/* Profile silhouettes in cards */}
              <circle cx="112" cy="37" r="5" fill="var(--primary)" opacity="0.15" />
              <circle cx="140" cy="37" r="5" fill="var(--primary)" opacity="0.15" />
              <circle cx="112" cy="71" r="5" fill="var(--primary)" opacity="0.15" />
              <circle cx="140" cy="71" r="5" fill="var(--primary)" opacity="0.15" />
              <text x="130" y="115" textAnchor="middle" fill="var(--secondary)" fontSize="12" fontFamily="var(--font)">
                Explore
              </text>
            </g>

            {/* Arrow 1→2 */}
            <g opacity={clamp((progress - 0.3) / 0.15, 0, 1)}>
              <line x1="200" y1="60" x2="290" y2="60" stroke="var(--primary)" strokeWidth="1.5" strokeDasharray="4 4" />
              <polygon points="290,55 300,60 290,65" fill="var(--primary)" opacity="0.5" />
            </g>

            {/* Phase 2: Swipe card */}
            <g opacity={clamp((progress - 0.3) / 0.15, 0, 1)}>
              <rect x="330" y="25" width="55" height="70" rx="8" stroke="var(--primary)" strokeWidth="1.5" opacity="0.3" transform={`rotate(-8, 357, 60)`} />
              <circle cx="357" cy="48" r="10" fill="var(--primary)" opacity="0.12" />
              <rect x="340" y="65" width="34" height="3" rx="1.5" fill="var(--primary)" opacity="0.1" />
              <text x="357" y="115" textAnchor="middle" fill="var(--secondary)" fontSize="12" fontFamily="var(--font)">
                Swipe
              </text>
            </g>

            {/* Arrow 2→3 */}
            <g opacity={clamp((progress - 0.4) / 0.1, 0, 1)}>
              <line x1="410" y1="60" x2="470" y2="60" stroke="var(--primary)" strokeWidth="1.5" strokeDasharray="4 4" />
              <polygon points="470,55 480,60 470,65" fill="var(--primary)" opacity="0.5" />
            </g>

            {/* Phase 3: Match heart */}
            <g opacity={clamp((progress - 0.45) / 0.15, 0, 1)}>
              <rect x="510" y="20" width="80" height="80" rx="16" stroke="var(--primary)" strokeWidth="1.5" opacity="0.3" />
              <path
                d="M 550 55 C 550 42, 530 42, 530 55 C 530 42, 510 42, 510 55 C 510 72, 530 85, 530 85 C 530 85, 550 72, 550 55 Z"
                fill="var(--primary)"
                opacity={0.15 + clamp((progress - 0.5) / 0.2, 0, 1) * 0.35}
              />
              <text x="550" y="115" textAnchor="middle" fill="var(--secondary)" fontSize="12" fontFamily="var(--font)">
                Match
              </text>
            </g>

            {/* Arrow 3→4 */}
            <g opacity={clamp((progress - 0.6) / 0.1, 0, 1)}>
              <line x1="610" y1="60" x2="670" y2="60" stroke="var(--primary)" strokeWidth="1.5" strokeDasharray="4 4" />
              <polygon points="670,55 680,60 670,65" fill="var(--primary)" opacity="0.5" />
            </g>

            {/* Phase 4: Chat bubble */}
            <g opacity={clamp((progress - 0.65) / 0.15, 0, 1)}>
              <rect x="710" y="30" width="70" height="50" rx="12" stroke="var(--primary)" strokeWidth="1.5" opacity="0.3" />
              <rect x="720" y="42" width="35" height="3" rx="1.5" fill="var(--primary)" opacity="0.15" />
              <rect x="720" y="50" width="25" height="3" rx="1.5" fill="var(--primary)" opacity="0.1" />
              <text x="745" y="115" textAnchor="middle" fill="var(--secondary)" fontSize="12" fontFamily="var(--font)">
                Chat & Meet
              </text>
            </g>
          </svg>
        </div>
      </div>
    </section>
  );
}

/* ─── SVG: Explore gallery grid ──────────────────────────── */
function CommunitySVG() {
  const ref = useRef<HTMLElement>(null);
  const progress = useScrollProgress(ref);
  const converge = clamp((progress - 0.2) / 0.5, 0, 1);

  return (
    <section className="section" id="community" ref={ref}>
      <div className="container center-text">
        <span className="section-label">EXPLORE</span>
        <h2 className="section-title">A gallery, not a roulette</h2>
        <p className="section-sub">
          Browse verified profiles like a gallery — clean, curated, and real.
          No bots, no fakes, no endless random swiping.
        </p>
        <div className="community-visual">
          <svg viewBox="0 0 400 300" className="community-svg" fill="none">
            {/* Gallery grid of profile cards */}
            {[0, 1, 2, 3, 4, 5].map((i) => {
              const col = i % 3;
              const row = Math.floor(i / 3);
              const x = 80 + col * 90;
              const y = 30 + row * 130;
              const delay = i * 0.08;
              const cardOpacity = clamp((converge - delay) / 0.3, 0, 1);
              return (
                <g key={i} opacity={0.15 + cardOpacity * 0.6} transform={`translate(0, ${(1 - cardOpacity) * 20})`}>
                  <rect x={x} y={y} width="70" height="100" rx="10" stroke="var(--primary)" strokeWidth="1.5" />
                  <circle cx={x + 35} cy={y + 32} r="14" fill="var(--primary)" opacity="0.1" />
                  <rect x={x + 15} y={y + 55} width="40" height="4" rx="2" fill="var(--primary)" opacity="0.1" />
                  <rect x={x + 20} y={y + 65} width="30" height="3" rx="1.5" fill="var(--primary)" opacity="0.07" />
                </g>
              );
            })}
            {/* Verified badge on one card */}
            <g opacity={clamp((converge - 0.5) / 0.3, 0, 1)}>
              <circle cx="185" cy="45" r="7" fill="var(--primary)" opacity="0.25" />
              <text x="185" y="48" textAnchor="middle" fill="var(--primary)" fontSize="8" fontWeight="700">✓</text>
            </g>
          </svg>
        </div>
      </div>
    </section>
  );
}

/* ─── SVG: On-Device AI Chat Coach ──────────────────────── */
function ChatCoachSVG() {
  const ref = useRef<HTMLElement>(null);
  const progress = useScrollProgress(ref);
  const reveal = clamp((progress - 0.15) / 0.5, 0, 1);

  // Chat messages
  const messages = [
    { from: 'them', text: 'so what do you do for fun?', delay: 0.1 },
    { from: 'me', text: 'honestly just hiking and cooking', delay: 0.25 },
    { from: 'them', text: 'oh nice! i love cooking too. what\'s your go-to?', delay: 0.4 },
  ];

  // AI suggestion chips
  const suggestions = [
    'ask about their favorite cuisine',
    'suggest a cooking date',
    'share a recipe you love',
  ];

  const suggestionsVisible = clamp((progress - 0.55) / 0.3, 0, 1);
  const chipOpacity = clamp((progress - 0.6) / 0.2, 0, 1);
  const lockOpacity = clamp((progress - 0.7) / 0.2, 0, 1);

  return (
    <section className="section" id="ai-coach" ref={ref}>
      <div className="container split-layout">
        <div className="split-text">
          <span className="section-label">ON-DEVICE AI</span>
          <h2>Your conversations,{'\n'}with a safety net</h2>
          <p>
            Not everyone is smooth talker. Kinetik runs a small language model{' '}
            <strong>entirely on your device</strong> — it reads your conversation and suggests{' '}
            what to say next. Your chats never leave your phone.
          </p>
          <div className="ai-privacy-badge">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <span>100% on-device. Zero server calls. Your data stays yours.</span>
          </div>
        </div>
        <div className="split-visual">
          <svg viewBox="0 0 300 440" className="chat-coach-svg" fill="none">
            {/* Phone frame */}
            <rect x="40" y="10" width="220" height="420" rx="32" stroke="var(--primary)" strokeWidth="2" opacity="0.2" />
            <rect x="48" y="18" width="204" height="404" rx="26" fill="var(--surface)" />

            {/* Header bar */}
            <rect x="48" y="18" width="204" height="52" rx="26" fill="var(--primary)" opacity="0.06" />
            <circle cx="82" cy="44" r="12" fill="var(--primary)" opacity="0.12" />
            <rect x="100" y="38" width="60" height="5" rx="2.5" fill="var(--primary)" opacity="0.15" />
            <rect x="100" y="47" width="40" height="3" rx="1.5" fill="var(--primary)" opacity="0.08" />

            {/* Chat messages */}
            {messages.map((msg, i) => {
              const msgReveal = clamp((reveal - msg.delay) / 0.12, 0, 1);
              const isMe = msg.from === 'me';
              const y = 90 + i * 65;
              const x = isMe ? 115 : 65;
              const maxW = 130;
              return (
                <g key={i} opacity={msgReveal} transform={`translate(0, ${(1 - msgReveal) * 10})`}>
                  <rect
                    x={x}
                    y={y}
                    width={maxW}
                    height={40}
                    rx={isMe ? '14 14 4 14' : '14 14 14 4'}
                    fill={isMe ? 'var(--primary)' : '#fff'}
                    opacity={isMe ? 0.9 : 1}
                    stroke={isMe ? 'none' : 'var(--card-border)'}
                  />
                  <text
                    x={x + 14}
                    y={y + 18}
                    fill={isMe ? '#fff' : 'var(--primary)'}
                    fontSize="9.5"
                    fontFamily="var(--font)"
                    opacity={0.85}
                  >
                    {msg.text.length > 28 ? msg.text.slice(0, 28) + '...' : msg.text}
                  </text>
                </g>
              );
            })}

            {/* AI suggestion chips — appear at bottom */}
            <g opacity={suggestionsVisible}>
              {/* Label */}
              <text x="150" y="310" textAnchor="middle" fill="var(--primary)" fontSize="9" fontWeight="700" fontFamily="var(--font)" opacity={chipOpacity * 0.5} letterSpacing="0.5">
                ✦ SUGGESTED BY AI
              </text>

              {/* Chips */}
              {suggestions.map((s, i) => {
                const chipDelay = i * 0.12;
                const chipVis = clamp((suggestionsVisible - chipDelay) / 0.2, 0, 1);
                const y = 325 + i * 32;
                const textLen = s.length * 5.5 + 28;
                return (
                  <g key={i} opacity={chipVis} transform={`translate(${(1 - chipVis) * 20}, 0)`}>
                    <rect
                      x={150 - textLen / 2}
                      y={y}
                      width={textLen}
                      height={26}
                      rx="13"
                      fill="none"
                      stroke="var(--primary)"
                      strokeWidth="1.2"
                      opacity="0.3"
                    />
                    <text
                      x={150}
                      y={y + 17}
                      textAnchor="middle"
                      fill="var(--primary)"
                      fontSize="9"
                      fontFamily="var(--font)"
                      opacity="0.65"
                    >
                      {s}
                    </text>
                  </g>
                );
              })}

              {/* Lock icon */}
              <g opacity={lockOpacity} transform="translate(137, 418)">
                <rect x="0" y="8" width="26" height="18" rx="3" fill="var(--primary)" opacity="0.15" />
                <path d="M 7 8 V 5 A 6 6 0 0 1 19 5 V 8" stroke="var(--primary)" strokeWidth="1.5" fill="none" opacity="0.3" />
                <circle cx="13" cy="17" r="2" fill="var(--primary)" opacity="0.3" />
              </g>
              <text x="150" y="440" textAnchor="middle" fill="var(--muted)" fontSize="8" fontFamily="var(--font)" opacity={lockOpacity * 0.7}>
                processed on-device only
              </text>
            </g>
          </svg>
        </div>
      </div>
    </section>
  );
}

/* ─── Features Grid ──────────────────────────────────────── */
const FEATURES = [
  {
    icon: '🧠',
    title: 'On-Device AI Coach',
    body: 'Stuck on what to say? A local LLM suggests replies in real-time — running entirely on your phone, never on our servers.',
  },
  {
    icon: '📸',
    title: 'Explore Gallery',
    body: 'Browse verified profiles in a clean gallery view. Real people, real photos, real compatibility — no roulette.',
  },
  {
    icon: '💬',
    title: 'Real-time Chat',
    body: 'Instant messaging with read receipts, typing indicators, and push notifications. No more dead silence.',
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
    icon: '∞',
    title: 'Unlimited swipes (Premium)',
    body: '30 swipes and 3 chats free. After that, swipes lock — Premium gives you unlimited swipes, 25 Super Likes/day, and more.',
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
    <CommunitySVG />
        <ChatCoachSVG />
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
          <span className="logo-mark">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </span>
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
