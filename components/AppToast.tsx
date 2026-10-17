import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { defiColors } from './defi/defiStyles';
import { theme } from '../theme';
import { subscribeToast, type ToastKind, type ToastPayload } from '../utils/toast';

const KIND_STYLES: Record<
  ToastKind,
  { bar: string; title: string; icon: string }
> = {
  success: { bar: defiColors.buy, title: defiColors.buy, icon: '✓' },
  error: { bar: theme.colors.error, title: '#ff8a8a', icon: '!' },
  info: { bar: defiColors.gold, title: defiColors.gold, icon: 'i' },
  loading: { bar: defiColors.gold, title: defiColors.gold, icon: '' },
};

export default function AppToast() {
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<ToastPayload | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-12)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shownId = useRef<number | null>(null);
  const dismissGen = useRef(0);

  const dismiss = useCallback(() => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    const gen = ++dismissGen.current;
    Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: 160, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: -10, duration: 160, useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (finished && dismissGen.current === gen) {
        shownId.current = null;
        setToast(null);
      }
    });
  }, [opacity, translateY]);

  useEffect(() => {
    const unsub = subscribeToast((next) => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      dismissGen.current += 1;
      const same = shownId.current === next.id;
      shownId.current = next.id;
      setToast(next);
      opacity.stopAnimation();
      translateY.stopAnimation();
      if (!same) {
        opacity.setValue(0);
        translateY.setValue(-12);
        Animated.parallel([
          Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
          Animated.timing(translateY, { toValue: 0, duration: 180, useNativeDriver: true }),
        ]).start();
      }
      if (next.duration > 0) {
        hideTimer.current = setTimeout(dismiss, next.duration);
      }
    });
    return () => {
      unsub();
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [dismiss, opacity, translateY]);

  const kind = toast ? KIND_STYLES[toast.kind] : KIND_STYLES.info;

  if (!toast) return null;

  return (
    <View pointerEvents="box-none" style={styles.overlay}>
      <Animated.View
        pointerEvents="auto"
        style={[
          styles.card,
          {
            marginTop: Math.max(insets.top, 12) + 8,
            opacity,
            transform: [{ translateY }],
          },
        ]}
      >
        <View style={[styles.bar, { backgroundColor: kind.bar }]} />
        <Pressable onPress={toast.kind === 'loading' ? undefined : dismiss} style={styles.body}>
          {toast.kind === 'loading' ? (
            <ActivityIndicator size="small" color={defiColors.gold} style={styles.spinner} />
          ) : (
            <View style={[styles.iconWrap, { borderColor: kind.bar }]}>
              <Text style={[styles.icon, { color: kind.title }]}>{kind.icon}</Text>
            </View>
          )}
          <View style={styles.textWrap}>
            <Text style={[styles.title, { color: kind.title }]} numberOfLines={2}>
              {toast.title}
            </Text>
            {toast.message ? (
              <Text style={styles.message} numberOfLines={4}>
                {toast.message}
              </Text>
            ) : null}
          </View>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    zIndex: 50,
    elevation: 50,
  },
  spinner: {
    marginTop: 1,
    width: 22,
    height: 22,
  },
  card: {
    width: '92%',
    maxWidth: 440,
    flexDirection: 'row',
    overflow: 'hidden',
    backgroundColor: defiColors.bgCard,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: defiColors.border,
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  bar: {
    width: 4,
  },
  body: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  iconWrap: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  icon: {
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 14,
  },
  textWrap: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 13,
    fontWeight: '700',
  },
  message: {
    marginTop: 3,
    color: defiColors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
  },
});
