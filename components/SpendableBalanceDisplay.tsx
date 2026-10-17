import React from 'react';
import { View, Text, StyleSheet, ViewStyle, TextStyle } from 'react-native';
import FormattedNumber from './FormattedNumber';
import { hasPositiveLocked } from '../utils/warthogFormat';
import { theme } from '../theme';
import { defiColors } from './defi/defiStyles';

export type SpendableBalanceLayout = 'stack' | 'inline' | 'row' | 'hero';

interface Props {
  /** Free to spend (total − locked − mempool) */
  available?: string | number | null;
  /** Locked in open orders / pending */
  locked?: string | number | null;
  /** Full on-chain total */
  total?: string | number | null;
  unit?: string;
  /** Coin mark shown beside the unit. */
  mark?: React.ReactNode;
  label?: string;
  layout?: SpendableBalanceLayout;
  showLabel?: boolean;
  style?: ViewStyle;
  primaryStyle?: TextStyle;
  unitStyle?: TextStyle;
}

/**
 * Consistent Available / Locked / Total presentation for WART and assets.
 * Primary number is free (available) when anything is locked; otherwise total.
 */
const SpendableBalanceDisplay: React.FC<Props> = ({
  available,
  locked,
  total,
  unit = '',
  mark,
  label = 'Available',
  layout = 'stack',
  showLabel = true,
  style,
  primaryStyle,
  unitStyle,
}) => {
  const free = available ?? total ?? '0';
  const showLocked = hasPositiveLocked(locked);
  const totalVal = total ?? free;

  const unitEl = unit ? (
    <Text style={[styles.unit, unitStyle]}>{unit}</Text>
  ) : null;

  if (layout === 'hero') {
    return (
      <View style={style}>
        {showLabel ? (
          <Text style={styles.heroLabel}>
            {showLocked ? 'Available Balance' : label === 'Available' ? 'Total Balance' : label}
          </Text>
        ) : null}
        <View style={styles.heroRow}>
          <FormattedNumber
            value={free}
            variant="balance"
            style={primaryStyle ? [styles.heroValue, primaryStyle] : styles.heroValue}
          />
          <View style={styles.heroUnit}>
            {mark}
            {unitEl}
          </View>
        </View>
        {showLocked ? (
          <View style={styles.metaRow}>
            <Text style={styles.metaText}>
              Total{' '}
              <FormattedNumber value={totalVal} variant="balance" style={styles.metaTotal} />
            </Text>
            <Text style={styles.metaLocked}>
              Locked{' '}
              <FormattedNumber value={locked} variant="balance" style={styles.metaLockedValue} />
              <Text style={styles.metaText}> (open orders)</Text>
            </Text>
          </View>
        ) : null}
      </View>
    );
  }

  if (layout === 'row') {
    return (
      <View style={[{ alignItems: 'flex-end', minWidth: 0, maxWidth: '100%', width: '100%' }, style]}>
        <View style={styles.rowPrimary}>
          <FormattedNumber
            value={free}
            variant="balance"
            style={primaryStyle ? [styles.rowValue, primaryStyle] : styles.rowValue}
          />
          {unit ? <Text style={[styles.rowUnit, unitStyle]}>{unit}</Text> : null}
        </View>
        {showLocked ? (
          <View style={styles.rowMeta}>
            <Text style={styles.metaText}>
              Total <FormattedNumber value={totalVal} variant="balance" style={styles.metaTotal} />
            </Text>
            <Text style={styles.metaLocked}>
              Locked <FormattedNumber value={locked} variant="balance" style={styles.metaLockedValue} />
            </Text>
          </View>
        ) : null}
      </View>
    );
  }

  if (layout === 'inline') {
    return (
      <Text style={[{ fontFamily: theme.typography.fontFamily.mono }, style as TextStyle]}>
        <FormattedNumber value={free} variant="balance" style={primaryStyle} />
        {unit ? ` ${unit}` : ''}
        {showLocked ? (
          <Text style={styles.inlineMeta}>
            {' '}
            (locked <FormattedNumber value={locked} variant="balance" style={styles.metaLockedValue} />
            {total != null ? (
              <>
                {' · '}total <FormattedNumber value={totalVal} variant="balance" style={styles.metaTotal} />
              </>
            ) : null}
            )
          </Text>
        ) : null}
      </Text>
    );
  }

  // stack — form cards (Send, limit order)
  return (
    <View style={[styles.stack, style]}>
      <View style={styles.stackRow}>
        {showLabel ? <Text style={styles.stackLabel}>{label}</Text> : <View />}
        <View style={styles.stackValueRow}>
          <FormattedNumber
            value={free}
            variant="balance"
            style={primaryStyle ? [styles.stackValue, primaryStyle] : styles.stackValue}
          />
          {mark}
          {unit ? <Text style={[styles.unit, unitStyle]}>{unit}</Text> : null}
        </View>
      </View>
      {showLocked ? (
        <View style={styles.stackMeta}>
          <Text style={styles.metaLocked}>
            Locked <FormattedNumber value={locked} variant="balance" style={styles.metaLockedValue} />
          </Text>
          <Text style={styles.metaText}>
            Total <FormattedNumber value={totalVal} variant="balance" style={styles.metaTotal} />
          </Text>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  unit: {
    color: defiColors.gold,
    fontFamily: theme.typography.fontFamily.regular,
    fontSize: theme.typography.bodySm,
  },
  heroLabel: {
    color: defiColors.textMuted,
    fontSize: 10,
    fontWeight: theme.typography.semiBold,
    textTransform: 'uppercase',
    letterSpacing: 1.4,
    marginBottom: 4,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  heroUnit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  heroValue: {
    color: theme.colors.textPrimary,
    fontSize: 28,
    fontWeight: theme.typography.semiBold,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 8,
  },
  metaText: {
    color: defiColors.textMuted,
    fontSize: 11,
  },
  metaTotal: {
    color: defiColors.textSecondary,
    fontFamily: theme.typography.fontFamily.mono,
    fontSize: 11,
  },
  metaLocked: {
    color: 'rgba(251, 191, 36, 0.9)',
    fontSize: 11,
  },
  metaLockedValue: {
    color: defiColors.amberText,
    fontFamily: theme.typography.fontFamily.mono,
    fontSize: 11,
  },
  rowPrimary: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    justifyContent: 'flex-end',
    gap: 4,
    maxWidth: '100%',
    minWidth: 0,
  },
  rowValue: {
    color: theme.colors.textPrimary,
    fontFamily: theme.typography.fontFamily.mono,
    fontSize: theme.typography.bodySm,
    flexShrink: 1,
    textAlign: 'right',
  },
  rowUnit: {
    color: defiColors.textMuted,
    fontSize: 10,
  },
  rowMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 2,
  },
  inlineMeta: {
    color: defiColors.textMuted,
    fontSize: 11,
  },
  stack: {
    gap: 4,
    marginBottom: theme.spacing.sm,
  },
  stackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  stackLabel: {
    color: defiColors.textMuted,
    fontSize: theme.typography.caption,
  },
  stackValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  stackValue: {
    color: theme.colors.textPrimary,
    fontFamily: theme.typography.fontFamily.mono,
    fontSize: theme.typography.caption,
  },
  stackMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
});

export default SpendableBalanceDisplay;
