import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Linking } from 'react-native';
import DefiModalShell from './DefiModalShell';
import TokenIcon from '../TokenIcon';
import { defiColors } from './defiStyles';
import { theme } from '../../theme';
import { readEthereumActivity, type EthActivityRow } from '../../utils/ethActivity';

interface Props {
  visible: boolean;
  address?: string;
  onClose: () => void;
}

function when(time: number): string {
  if (!time) return '';
  return new Date(time * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const toneColor = {
  in: defiColors.buy,
  out: defiColors.textSecondary,
  swap: defiColors.gold,
  fail: defiColors.rose,
} as const;

const EthActivityModal: React.FC<Props> = ({ visible, address, onClose }) => {
  const [rows, setRows] = useState<EthActivityRow[]>([]);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!address) {
      setRows([]);
      setWarning(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const next = await readEthereumActivity(address);
      setRows(next.rows);
      setWarning(next.warning);
    } catch (err: unknown) {
      setRows([]);
      setWarning(null);
      setError(err instanceof Error ? err.message : 'Ethereum activity is unavailable.');
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    if (!visible) return;
    void load();
  }, [visible, load]);

  return (
    <DefiModalShell
      visible={visible}
      onClose={onClose}
      title="Activity"
      subtitle={address ? 'Ethereum mainnet · ETH and USDT' : 'Ethereum'}
    >
      {!address ? (
        <Text style={styles.hint}>
          This wallet has no Ethereum account. Activity lists transfers for the Ethereum address from a recovery phrase.
        </Text>
      ) : (
        <>
          <View style={styles.toolbar}>
            <Text style={styles.hint}>Latest Ethereum transfers for this account.</Text>
            <TouchableOpacity onPress={() => { void load(); }} disabled={loading}>
              <Text style={styles.refresh}>{loading ? 'Loading…' : 'Refresh'}</Text>
            </TouchableOpacity>
          </View>
          {loading && rows.length === 0 ? <ActivityIndicator color={theme.colors.primary} /> : null}
          {error ? <Text style={styles.warn}>{error}</Text> : null}
          {warning ? <Text style={styles.hint}>{warning}</Text> : null}
          {!loading && !error && rows.length === 0 ? (
            <Text style={styles.hint}>No Ethereum transactions yet.</Text>
          ) : null}
          {rows.map((row) => (
            <TouchableOpacity
              key={row.id}
              style={styles.row}
              onPress={() => { void Linking.openURL(`https://etherscan.io/tx/${row.hash}`); }}
            >
              <View style={styles.marks}>
                {row.symbol ? <TokenIcon symbol={row.symbol} size={22} /> : null}
                {row.paySymbol ? <TokenIcon symbol={row.paySymbol} size={22} /> : null}
                {row.receiveSymbol && row.receiveSymbol !== row.paySymbol ? (
                  <TokenIcon symbol={row.receiveSymbol} size={22} />
                ) : null}
              </View>
              <View style={styles.copy}>
                <Text style={styles.title}>{row.title}</Text>
                <Text style={styles.sub} numberOfLines={1}>
                  {when(row.time)}{row.subtitle ? ` · ${row.subtitle}` : ''}
                </Text>
              </View>
              <Text style={[styles.amount, { color: toneColor[row.tone] }]}>{row.amount}</Text>
            </TouchableOpacity>
          ))}
        </>
      )}
    </DefiModalShell>
  );
};

const styles = {
  toolbar: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginBottom: 8,
  },
  refresh: {
    color: defiColors.gold,
    fontSize: 12,
    fontWeight: '600' as const,
  },
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(39, 39, 42, 0.8)',
  },
  marks: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    width: 48,
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: '#f4f4f5',
    fontSize: 13,
    fontWeight: '600' as const,
  },
  sub: {
    color: defiColors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  amount: {
    fontSize: 11,
    fontVariant: ['tabular-nums' as const],
    textAlign: 'right' as const,
    maxWidth: 130,
  },
  hint: {
    color: defiColors.textMuted,
    fontSize: 11,
    lineHeight: 16,
    flex: 1,
  },
  warn: {
    color: defiColors.amberText,
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 8,
  },
};

export default EthActivityModal;
