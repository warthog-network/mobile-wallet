import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Text, TouchableOpacity, View } from 'react-native';
import TokenIcon, { tokenMark } from '../TokenIcon';
import DefiModalShell from './DefiModalShell';
import { defiColors } from './defiStyles';
import { swapPanelStyles as panel } from './swapPanelStyles';
import { theme } from '../../theme';
import {
  readTransferActivity,
  readTunnelActivity,
  type ActivityChain,
  type ActivityItem,
} from '../../utils/networkActivity';

interface Props {
  visible: boolean;
  chain: ActivityChain;
  ethAddress?: string;
  btcAddress?: string;
  solAddress?: string;
  onClose: () => void;
}

const NAMES: Record<ActivityChain, string> = {
  wart: 'Warthog',
  ethereum: 'Ethereum',
  bitcoin: 'Bitcoin',
  hemi: 'Hemi',
  solana: 'Solana',
};

function when(time: number): string {
  if (!time) return 'Pending';
  return new Date(time).toLocaleString(undefined, {
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

/** Transfers for the selected network, plus tunnel history when this wallet has used one. */
const NetworkActivityModal: React.FC<Props> = ({
  visible,
  chain,
  ethAddress,
  btcAddress,
  solAddress,
  onClose,
}) => {
  const [tab, setTab] = useState<'transfers' | 'tunnels'>('transfers');
  const [rows, setRows] = useState<ActivityItem[]>([]);
  const [tunnels, setTunnels] = useState<ActivityItem[]>([]);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    const addresses = { eth: ethAddress, btc: btcAddress, sol: solAddress };
    try {
      const [transfers, tunnelRows] = await Promise.all([
        readTransferActivity(chain, addresses),
        readTunnelActivity(chain, addresses),
      ]);
      setRows(transfers.rows);
      setWarning(transfers.warning);
      setTunnels(tunnelRows);
    } catch (err: unknown) {
      if (!quiet) {
        setRows([]);
        setTunnels([]);
        setWarning(null);
      }
      setError(err instanceof Error ? err.message : 'Activity is unavailable.');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [chain, ethAddress, btcAddress, solAddress]);

  useEffect(() => {
    if (!visible) return;
    setTab('transfers');
    void load();
  }, [visible, load]);

  const tunnelSpinning = tunnels.some((row) => row.spinning);
  useEffect(() => {
    if (!visible || tab !== 'tunnels' || !tunnelSpinning) return undefined;
    const timer = setInterval(() => { void load(true); }, 20_000);
    return () => clearInterval(timer);
  }, [visible, tab, tunnelSpinning, load]);

  const shown = tab === 'tunnels' ? tunnels : rows;

  return (
    <DefiModalShell
      visible={visible}
      onClose={onClose}
      title="Activity"
      subtitle={NAMES[chain]}
    >
      {chain === 'wart' ? (
        <Text style={panel.hint}>WART transfers are on the History tab.</Text>
      ) : (
        <>
          <View style={panel.chipRow}>
            {(['transfers', 'tunnels'] as const).map((choice) => {
              const on = tab === choice;
              const label = choice === 'transfers' ? 'Transfers' : `Tunnels${tunnels.length ? ` ${tunnels.length}` : ''}`;
              return (
                <TouchableOpacity
                  key={choice}
                  style={[panel.chip, on && panel.chipActive]}
                  onPress={() => setTab(choice)}
                >
                  <Text style={[panel.chipText, on && panel.chipTextActive]}>{label}</Text>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity onPress={() => { void load(); }} disabled={loading}>
              <Text style={refresh}>{loading ? 'Loading…' : 'Refresh'}</Text>
            </TouchableOpacity>
          </View>
          {loading && shown.length === 0 ? <ActivityIndicator color={theme.colors.primary} /> : null}
          {error ? <Text style={panel.warn}>{error}</Text> : null}
          {warning && tab === 'transfers' ? <Text style={panel.hint}>{warning}</Text> : null}
          {!loading && !error && shown.length === 0 ? (
            <Text style={panel.hint}>
              {tab === 'tunnels' ? 'No tunnels from this wallet yet.' : `No ${NAMES[chain]} transactions yet.`}
            </Text>
          ) : null}
          {shown.map((row) => (
            <TouchableOpacity
              key={row.id}
              style={item}
              onPress={row.url ? () => { void Linking.openURL(row.url as string); } : undefined}
            >
              <TokenIcon symbol={tokenMark(row.symbol || 'ETH', chain, true)} size={22} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={title}>{row.title}</Text>
                <View style={stepLine}>
                  {row.spinning ? <ActivityIndicator size="small" color={defiColors.gold} /> : null}
                  <Text style={[sub, row.spinning && stepText]} numberOfLines={2}>{when(row.time)} · {row.subtitle}</Text>
                </View>
              </View>
              <Text style={[amount, { color: toneColor[row.tone] }]}>{row.amount}</Text>
            </TouchableOpacity>
          ))}
        </>
      )}
    </DefiModalShell>
  );
};

const refresh = { color: defiColors.gold, fontSize: 12, fontWeight: '600' as const };
const item = {
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  gap: 8,
  paddingVertical: 10,
  borderBottomWidth: 1,
  borderBottomColor: 'rgba(39, 39, 42, 0.8)',
};
const title = { color: '#f4f4f5', fontSize: 13, fontWeight: '600' as const };
const stepLine = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, marginTop: 2 };
const stepText = { flex: 1, marginTop: 0 };
const sub = { color: defiColors.textMuted, fontSize: 11, marginTop: 2 };
const amount = { fontSize: 11, textAlign: 'right' as const, maxWidth: 130 };

export default NetworkActivityModal;
