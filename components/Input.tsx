// components/Input.tsx - Consistent styled input component

import React, { useState } from 'react';
import {
  TextInput,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInputProps,
} from 'react-native';
import { colors, spacing, borderRadius, typography, presets } from '../theme';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  rightIcon?: React.ReactNode;
  onRightIconPress?: () => void;
}

export const Input: React.FC<InputProps> = ({
  label,
  error,
  rightIcon,
  onRightIconPress,
  style,
  ...props
}) => {
  const [isFocused, setIsFocused] = useState(false);

  return (
    <View style={styles.container}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View style={styles.inputWrapper}>
        <TextInput
          style={[
            styles.input,
            isFocused && styles.inputFocused,
            error && styles.inputError,
            style,
          ]}
          placeholderTextColor={colors.textMuted}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          {...props}
        />
        {rightIcon && (
          <TouchableOpacity
            style={styles.rightIcon}
            onPress={onRightIconPress}
          >
            {rightIcon}
          </TouchableOpacity>
        )}
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.md,
  },
  label: {
    color: colors.textSecondary,
    fontSize: typography.bodySm,
    marginBottom: spacing.sm,
    fontWeight: typography.medium,
  },
  inputWrapper: {
    position: 'relative',
  },
  input: {
    ...presets.input,
  },
  inputFocused: {
    borderColor: colors.primary,
    borderWidth: 2,
  },
  inputError: {
    borderColor: colors.error,
  },
  rightIcon: {
    position: 'absolute',
    right: spacing.md,
    top: '50%',
    transform: [{ translateY: -12 }],
  },
  error: {
    color: colors.error,
    fontSize: typography.caption,
    marginTop: spacing.xs,
  },
});
