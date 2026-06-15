import { Dimensions } from 'react-native';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// ─── Colors ──────────────────────────────────────────────
export const colors = {
  // Primary palette
  primary: '#FF3B7F',
  primaryLight: '#FF6B9D',
  primaryDark: '#CC2F66',

  // Secondary
  secondary: '#7C3AED',
  secondaryLight: '#A78BFA',
  secondaryDark: '#5B21B6',

  // Accent
  accent: '#06D6A0',
  accentLight: '#34E8B4',

  // Neutrals
  background: '#0A0A0F',
  surface: '#141418',
  surfaceLight: '#1C1C24',
  surfaceHighlight: '#252533',

  // Text
  textPrimary: '#FFFFFF',
  textSecondary: '#9CA3AF',
  textMuted: '#6B7280',
  textInverse: '#0A0A0F',

  // Status
  success: '#06D6A0',
  warning: '#FBBF24',
  error: '#EF4444',
  info: '#3B82F6',

  // Match Engine
  vibeActive: '#FF3B7F',
  vibeConnecting: '#FBBF24',
  vibeConnected: '#06D6A0',
  vibeLock: '#7C3AED',

  // Gradients
  gradientStart: '#FF3B7F',
  gradientEnd: '#7C3AED',
  gradientMatch: ['#FF3B7F', '#FF6B9D', '#7C3AED'] as const,

  // Overlays
  overlay: 'rgba(0, 0, 0, 0.6)',
  overlayLight: 'rgba(0, 0, 0, 0.3)',
  shimmer: ['rgba(255,255,255,0.1)', 'rgba(255,255,255,0.05)', 'rgba(255,255,255,0.1)'] as const,

  // Specific UI
  radarBg: '#0D0D1A',
  radarPulse: '#FF3B7F',
  radarRing: 'rgba(255, 59, 127, 0.2)',
  cardBorder: 'rgba(255, 255, 255, 0.08)',
  inputBg: '#1C1C24',
  inputBorder: 'rgba(255, 255, 255, 0.12)',
  inputFocusBorder: '#FF3B7F',
  tabBarBg: '#0A0A0F',
  tabBarBorder: 'rgba(255, 255, 255, 0.08)',
};

// ─── Typography ──────────────────────────────────────────
export const typography = {
  h1: { fontSize: 32, lineHeight: 40, fontWeight: '700' as const, letterSpacing: -0.5 },
  h2: { fontSize: 26, lineHeight: 34, fontWeight: '700' as const, letterSpacing: -0.3 },
  h3: { fontSize: 22, lineHeight: 30, fontWeight: '600' as const, letterSpacing: -0.2 },
  h4: { fontSize: 18, lineHeight: 26, fontWeight: '600' as const },
  body1: { fontSize: 16, lineHeight: 24, fontWeight: '400' as const },
  body2: { fontSize: 14, lineHeight: 20, fontWeight: '400' as const },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' as const },
  button: { fontSize: 16, lineHeight: 24, fontWeight: '600' as const, letterSpacing: 0.5 },
  buttonSmall: { fontSize: 14, lineHeight: 20, fontWeight: '600' as const, letterSpacing: 0.3 },
  label: { fontSize: 12, lineHeight: 16, fontWeight: '500' as const, letterSpacing: 0.5, textTransform: 'uppercase' as const },
  countdown: { fontSize: 64, lineHeight: 72, fontWeight: '700' as const, letterSpacing: -2 },
  timer: { fontSize: 48, lineHeight: 56, fontWeight: '300' as const, letterSpacing: 2 },
};

// ─── Spacing ─────────────────────────────────────────────
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
  massive: 64,
};

// ─── Border Radius ───────────────────────────────────────
export const radius = {
  sm: 6,
  md: 10,
  lg: 16,
  xl: 20,
  xxl: 28,
  full: 9999,
};

// ─── Shadows ─────────────────────────────────────────────
export const shadows = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 2,
  },
  md: {
    shadowColor: '#FF3B7F',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  glow: {
    shadowColor: '#FF3B7F',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 6,
  },
};

// ─── Animation ───────────────────────────────────────────
export const animation = {
  quick: 200,
  normal: 300,
  slow: 500,
  spring: {
    damping: 15,
    stiffness: 150,
    mass: 1,
  },
};

// ─── Layout ──────────────────────────────────────────────
export const layout = {
  screenWidth: SCREEN_WIDTH,
  screenHeight: SCREEN_HEIGHT,
  contentPadding: spacing.xl,
  safeTop: 44,
  safeBottom: 34,
  tabBarHeight: 80,
  headerHeight: 56,
};

export const theme = {
  colors,
  typography,
  spacing,
  radius,
  shadows,
  animation,
  layout,
};

export type Theme = typeof theme;
export default theme;
