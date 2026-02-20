// components/Button.tsx - Modern button component with variants

import React from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  ViewStyle,
  TextStyle,
  TouchableOpacityProps,
} from 'react-native';
import { colors, spacing, borderRadius, typography, shadows } from '../theme';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline';
type ButtonSize = 'small' | 'medium' | 'large';

interface ButtonProps extends TouchableOpacityProps {
  title: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
  fullWidth?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  title,
  variant = 'primary',
  size = 'medium',
  loading = false,
  icon,
  fullWidth = false,
  disabled,
  style,
  ...props
}) => {
  const buttonStyle = [
    styles.base,
    styles[variant],
    styles[`${size}Button`],
    fullWidth && styles.fullWidth,
    disabled && styles.disabled,
    style,
  ];

  const textStyle = [
    styles.baseText,
    styles[`${variant}Text`],
    styles[`${size}Text`],
    disabled && styles.disabledText,
  ];

  return (
    <TouchableOpacity
      style={buttonStyle}
      disabled={disabled || loading}
      activeOpacity={0.7}
      {...props}
    >
      {loading ? (
        <ActivityIndicator
          color={variant === 'primary' ? colors.surface : colors.primary}
          size="small"
        />
      ) : (
        <>
          {icon}
          <Text style={textStyle}>{title}</Text>
        </>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.sm,
    gap: spacing.sm,
  },
  
  // Variants
  primary: {
    backgroundColor: colors.primary,
    borderWidth: 0,
    ...shadows.medium,
  },
  
  secondary: {
    backgroundColor: colors.surfaceLight,
    borderWidth: 0,
  },
  
  danger: {
    backgroundColor: colors.error,
    borderWidth: 0,
  },
  
  ghost: {
    backgroundColor: 'transparent',
    borderWidth: 0,
  },
  
  outline: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: colors.border,
  },
  
  // Sizes
  smallButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    minWidth: 60,
  },
  
  mediumButton: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    minWidth: 80,
  },
  
  largeButton: {
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
    minWidth: 120,
  },
  
  fullWidth: {
    width: '100%',
  },
  
  disabled: {
    opacity: 0.5,
  },
  
  // Text styles
  baseText: {
    fontWeight: typography.semiBold,
    textAlign: 'center',
  },
  
  primaryText: {
    color: colors.surface,
    fontSize: typography.body,
  },
  
  secondaryText: {
    color: colors.textPrimary,
    fontSize: typography.body,
  },
  
  dangerText: {
    color: colors.textPrimary,
    fontSize: typography.body,
  },
  
  ghostText: {
    color: colors.primary,
    fontSize: typography.body,
  },
  
  outlineText: {
    color: colors.textSecondary,
    fontSize: typography.body,
  },
  
  smallText: {
    fontSize: typography.caption,
  },
  
  mediumText: {
    fontSize: typography.body,
  },
  
  largeText: {
    fontSize: typography.h4,
  },
  
  disabledText: {
    opacity: 0.7,
  },
});
