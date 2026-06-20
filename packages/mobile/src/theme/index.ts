import { Dimensions } from 'react-native';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// ─── Colors ──────────────────────────────────────────────
export const colors = {
  // Primary palette
  primary: '#000000',
  primaryLight: '#333333',
  primaryDark: '#000000',

  // Secondary
  secondary: '#666666',
  secondaryLight: '#999999',
  secondaryDark: '#333333',

  // Accent
  accent: '#000000',
  accentLight: '#333333',

  // Neutrals
  background: '#FFFFFF',
  surface: '#F8F8F8',
  surfaceLight: '#F0F0F0',
  surfaceHighlight: '#E8E8E8',

  // Text
  textPrimary: '#000000',
  textSecondary: '#666666',
  textMuted: '#999999',
  textInverse: '#FFFFFF',

  // Status
  success: '#000000',
  warning: '#666666',
  error: '#000000',
  info: '#666666',

  // Match Engine
  vibeActive: '#000000',
  vibeConnecting: '#666666',
  vibeConnected: '#333333',
  vibeLock: '#000000',

  // Gradients
  gradientStart: '#000000',
  gradientEnd: '#000000',
  gradientMatch: ['#000000', '#333333', '#666666'] as const,

  // Overlays
  overlay: 'rgba(0, 0, 0, 0.6)',
  overlayLight: 'rgba(0, 0, 0, 0.3)',
  shimmer: ['rgba(0,0,0,0.08)', 'rgba(0,0,0,0.04)', 'rgba(0,0,0,0.08)'] as const,

  // Specific UI
  radarBg: '#FFFFFF',
  radarPulse: '#000000',
  radarRing: 'rgba(0, 0, 0, 0.15)',
  cardBorder: 'rgba(0, 0, 0, 0.08)',
  inputBg: '#F5F5F5',
  inputBorder: 'rgba(0, 0, 0, 0.12)',
  inputFocusBorder: '#000000',
  tabBarBg: '#FFFFFF',
  tabBarBorder: 'rgba(0, 0, 0, 0.08)',
};

// ─── Typography ──────────────────────────────────────────
export const typography = {
  h1: { fontSize: 28, lineHeight: 34, fontWeight: '700' as const, letterSpacing: -0.5 },
  h2: { fontSize: 22, lineHeight: 28, fontWeight: '700' as const, letterSpacing: -0.3 },
  h3: { fontSize: 18, lineHeight: 24, fontWeight: '600' as const, letterSpacing: -0.2 },
  h4: { fontSize: 16, lineHeight: 22, fontWeight: '600' as const },
  body1: { fontSize: 14, lineHeight: 20, fontWeight: '400' as const },
  body2: { fontSize: 13, lineHeight: 18, fontWeight: '400' as const },
  caption: { fontSize: 11, lineHeight: 15, fontWeight: '400' as const },
  button: { fontSize: 14, lineHeight: 20, fontWeight: '600' as const, letterSpacing: 0.5 },
  buttonSmall: { fontSize: 12, lineHeight: 17, fontWeight: '600' as const, letterSpacing: 0.3 },
  label: { fontSize: 11, lineHeight: 15, fontWeight: '500' as const, letterSpacing: 0.5, textTransform: 'uppercase' as const },
  countdown: { fontSize: 56, lineHeight: 64, fontWeight: '700' as const, letterSpacing: -2 },
  timer: { fontSize: 42, lineHeight: 48, fontWeight: '300' as const, letterSpacing: 2 },
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
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
