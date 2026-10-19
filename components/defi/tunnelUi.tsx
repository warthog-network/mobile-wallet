import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import TokenIcon, { type TokenSymbol } from '../TokenIcon';
import { defiColors } from './defiStyles';
import { theme } from '../../theme';

export function shortAddr(value: string, head = 8, tail = 6): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function formatWhen(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatRemain(targetMs: number, now = Date.now()): string {
  const left = targetMs - now;
  if (left <= 15_000) return 'Any moment';
  const minutes = Math.ceil(left / 60_000);
  if (minutes < 60) return minutes === 1 ? 'About 1 minute' : `About ${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (hours < 48) {
    if (rem === 0) return hours === 1 ? 'About 1 hour' : `About ${hours} hours`;
    return `About ${hours}h ${rem}m`;
  }
  const days = Math.round(hours / 24);
  return days === 1 ? 'About 1 day' : `About ${days} days`;
}

export function SpinCoin({ spinning }: { spinning: boolean }) {
  const turn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!spinning) {
      turn.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(turn, { toValue: 1, duration: 1100, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [spinning, turn]);
  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <TokenIcon symbol="HEMI" size={28} />
    </Animated.View>
  );
}

export function AvailRow({
  icon,
  ticker,
  detail,
  amount,
  bordered,
}: {
  icon: TokenSymbol;
  ticker: string;
  detail: string;
  amount: string;
  bordered?: boolean;
}) {
  return (
    <View style={[styles.availRow, bordered && styles.availBorder]}>
      <TokenIcon symbol={icon} size={28} />
      <View style={styles.availCopy}>
        <Text style={styles.ticker}>{ticker}</Text>
        <Text style={styles.detail}>{detail}</Text>
      </View>
      <View style={styles.availAmt}>
        <Text style={styles.amt}>{amount}</Text>
        <Text style={styles.detail}>{ticker}</Text>
      </View>
    </View>
  );
}

export function QuoteLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.line}>
      <Text style={styles.lineLabel}>{label}</Text>
      <Text style={styles.lineValue}>{value}</Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  moves: { gap: 8, marginBottom: 12 },
  hero: {
    backgroundColor: defiColors.bgCard,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: defiColors.border,
    padding: 16,
    marginBottom: 12,
    overflow: 'hidden',
  },
  accent: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: defiColors.goldHover,
  },
  kickerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  kicker: {
    color: defiColors.textMuted,
    fontSize: 10,
    fontWeight: theme.typography.semiBold,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  direction: {
    color: theme.colors.textPrimary,
    fontFamily: theme.typography.fontFamily.mono,
    fontSize: 22,
    fontWeight: theme.typography.semiBold,
    marginTop: 8,
  },
  meta: {
    color: defiColors.textMuted,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 6,
  },
  card: {
    backgroundColor: defiColors.bgCard,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: defiColors.border,
    padding: 14,
    marginBottom: 12,
  },
  availRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  availBorder: {
    borderTopWidth: 1,
    borderTopColor: defiColors.borderMuted,
  },
  availCopy: { flex: 1, minWidth: 0 },
  availAmt: { alignItems: 'flex-end', maxWidth: '46%' },
  ticker: {
    color: theme.colors.textPrimary,
    fontSize: 14,
    fontWeight: theme.typography.semiBold,
  },
  detail: { color: defiColors.textMuted, fontSize: 11 },
  amt: {
    color: theme.colors.textPrimary,
    fontFamily: theme.typography.fontFamily.mono,
    fontSize: 14,
    fontWeight: theme.typography.semiBold,
    textAlign: 'right',
  },
  choice: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  choiceBtn: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(82, 82, 91, 0.5)',
    backgroundColor: 'rgba(39, 39, 42, 0.8)',
    alignItems: 'center',
  },
  choiceOn: {
    backgroundColor: 'rgba(231, 147, 0, 0.12)',
    borderColor: 'rgba(231, 147, 0, 0.6)',
  },
  choiceText: {
    color: defiColors.textSecondary,
    fontSize: 13,
    fontWeight: theme.typography.semiBold,
  },
  choiceTextOn: { color: defiColors.goldHover },
  fieldLabel: {
    color: defiColors.textSecondary,
    fontSize: 12,
    fontWeight: theme.typography.semiBold,
    marginBottom: 6,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  line: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    marginVertical: 6,
  },
  lineLabel: { color: defiColors.textMuted, fontSize: 13, flexShrink: 1, maxWidth: '46%' },
  lineValue: {
    color: theme.colors.textPrimary,
    fontFamily: theme.typography.fontFamily.mono,
    fontSize: 13,
    fontWeight: theme.typography.semiBold,
    textAlign: 'right',
    flex: 1,
  },
  fine: {
    color: defiColors.textMuted,
    fontSize: 11,
    lineHeight: 16,
    marginBottom: 8,
  },
  stepCard: { marginTop: 4 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  stepCopy: { flex: 1, minWidth: 0 },
  stepTitle: {
    color: theme.colors.textPrimary,
    fontSize: 14,
    fontWeight: theme.typography.semiBold,
  },
  eta: { color: defiColors.textSecondary, fontSize: 12, marginTop: 2 },
  cardTitle: {
    color: theme.colors.textPrimary,
    fontSize: 14,
    fontWeight: theme.typography.semiBold,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 12,
  },
  link: {
    color: defiColors.goldHover,
    fontSize: 13,
    fontWeight: theme.typography.semiBold,
    marginTop: 8,
    marginBottom: 8,
  },
  actionLink: {
    color: defiColors.goldHover,
    fontSize: 13,
    fontWeight: theme.typography.semiBold,
  },
  primary: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(231, 147, 0, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(231, 147, 0, 0.6)',
    alignItems: 'center',
  },
  wide: { marginTop: 4 },
  disabled: { opacity: 0.45 },
  primaryText: {
    color: defiColors.goldHover,
    fontSize: 13,
    fontWeight: theme.typography.semiBold,
  },
  foot: {
    color: defiColors.textMuted,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 16,
  },
});
