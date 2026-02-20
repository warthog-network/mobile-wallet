// components/Card.tsx - Card component with glassmorphism effect

import React from 'react';
import { View, StyleSheet, ViewProps } from 'react-native';
import { colors, spacing, borderRadius, shadows, presets } from '../theme';

interface CardProps extends ViewProps {
  variant?: 'solid' | 'glass' | 'elevated';
  children: React.ReactNode;
}

export const Card: React.FC<CardProps> = ({
  variant = 'solid',
  children,
  style,
  ...props
}) => {
  return (
    <View style={[styles.base, styles[variant], style]} {...props}>
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  base: {
    borderRadius: borderRadius.md,
    padding: spacing.lg,
    borderWidth: 2,
    borderColor: colors.border,
  },
  solid: {
    backgroundColor: colors.surface,
  },
  glass: {
    backgroundColor: 'rgba(28, 37, 38, 0.85)',
  },
  elevated: {
    backgroundColor: colors.surfaceLight,
    ...shadows.large,
  },
});
