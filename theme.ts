// theme.ts - Centralized theme configuration
// Cyberpunk meets DOS terminal aesthetic

export const colors = {
  // Backgrounds
  background: '#070707',
  surface: '#1C2526',
  surfaceLight: '#474747',
  surfaceElevated: '#2A3335',
  
  // Primary (Warthog Gold)
  primary: '#FFC107',
  primaryDark: '#FFA000',
  primaryLight: '#FFECB3',
  
  // Semantic colors
  success: '#4CAF50',
  error: '#FF4444',
  warning: '#FF9800',
  info: '#2196F3',
  
  // Text
  textPrimary: '#FFFFFF',
  textSecondary: '#FFECB3',
  textMuted: '#888888',
  
  // Overlays
  overlay: 'rgba(0, 0, 0, 0.95)',
  overlayLight: 'rgba(0, 0, 0, 0.7)',
  
  // Borders
  border: '#FFC107',
  borderLight: '#474747',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
};

export const borderRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  round: 999,
};

export const typography = {
  // Font sizes
  h1: 28,
  h2: 24,
  h3: 20,
  h4: 18,
  body: 16,
  bodySm: 14,
  caption: 12,
  tiny: 11,
  
  // Font weights
  regular: '400' as const,
  medium: '500' as const,
  semiBold: '600' as const,
  bold: '700' as const,
  
  // Font families (for addresses/hashes)
  fontFamily: {
    regular: 'System',
    mono: 'Courier New',
  },
};

export const shadows = {
  small: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 2,
  },
  medium: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4.65,
    elevation: 4,
  },
  large: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.37,
    shadowRadius: 7.49,
    elevation: 8,
  },
  glow: {
    shadowColor: '#FFC107',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 5,
  },
};

export const animation = {
  fast: 150,
  normal: 300,
  slow: 500,
};

// Pre-built component styles
export const presets = {
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.lg,
    borderWidth: 2,
    borderColor: colors.border,
  },
  
  cardGlass: {
    backgroundColor: 'rgba(28, 37, 38, 0.8)',
    borderRadius: borderRadius.md,
    padding: spacing.lg,
    borderWidth: 2,
    borderColor: colors.border,
    backdropFilter: 'blur(10px)',
  },
  
  input: {
    backgroundColor: colors.surface,
    color: colors.textPrimary,
    padding: spacing.lg,
    borderRadius: borderRadius.sm,
    borderWidth: 2,
    borderColor: colors.border,
    fontSize: typography.body,
  },
};

export const theme = {
  colors,
  spacing,
  borderRadius,
  typography,
  shadows,
  animation,
  presets,
};

export type Theme = typeof theme;
