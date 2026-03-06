// components/LoadingSkeleton.tsx - Loading skeleton component

import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, ViewProps } from 'react-native';
import { colors, borderRadius, spacing } from '../theme';

interface LoadingSkeletonProps extends ViewProps {
  width?: number | `${number}%` | 'auto';  // Specific string patterns
  height?: number;
  borderRadius?: number;
}

export const LoadingSkeleton: React.FC<LoadingSkeletonProps> = ({
  width = '100%',
  height = 20,
  borderRadius: radius = borderRadius.sm,
  style,
  ...props
}) => {
  const animatedValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(animatedValue, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(animatedValue, {
          toValue: 0,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, []);

  const opacity = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.7],
  });

  return (
    <Animated.View
      style={[
        styles.skeleton,
        {
          width,
          height,
          borderRadius: radius,
          opacity,
        },
        style,
      ]}
      {...props}
    />
  );
};

// Preset skeleton layouts
export const BalanceSkeleton: React.FC = () => (
  <View style={styles.balanceContainer}>
    <LoadingSkeleton width="40%" height={16} style={{ marginBottom: spacing.sm }} />
    <LoadingSkeleton width="60%" height={32} style={{ marginBottom: spacing.xs }} />
    <LoadingSkeleton width="30%" height={20} style={{ marginBottom: spacing.md }} />
    <LoadingSkeleton width="80%" height={14} />
  </View>
);

export const TransactionSkeleton: React.FC = () => (
  <View style={styles.transactionContainer}>
    <LoadingSkeleton width="100%" height={14} style={{ marginBottom: spacing.sm }} />
    <LoadingSkeleton width="90%" height={14} style={{ marginBottom: spacing.sm }} />
    <LoadingSkeleton width="70%" height={14} style={{ marginBottom: spacing.sm }} />
    <LoadingSkeleton width="50%" height={14} />
  </View>
);

const styles = StyleSheet.create({
  skeleton: {
    backgroundColor: colors.surfaceLight,
  },
  balanceContainer: {
    padding: spacing.lg,
  },
  transactionContainer: {
    padding: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surface,
    marginBottom: spacing.md,
    borderWidth: 2,
    borderColor: colors.borderLight,
  },
});
