import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { defiStyles } from './defiStyles';
import { theme } from '../../theme';
import TokenIcon, { type TokenSymbol } from '../TokenIcon';
import FormattedNumber from '../FormattedNumber';
import HemiTunnelModal from './HemiTunnelModal';
import NetworkSendModal, { type NetworkKind } from './NetworkSendModal';
import SolSwapModal from './SolSwapModal';
import { fetchBtcBalance, formatBtc } from '../../utils/networks/btc';
import { fetchHemiBalance, formatHemi } from '../../utils/networks/hemi';
import { fetchSolBalance, formatSol } from '../../utils/networks/solana';

interface Props {
  btcAddress?: string;
  hemiAddress?: string;
  solAddress?: string;
  accountKind?: 'software' | 'ledger';
  refreshing?: boolean;
  onCopyAddress: (address: string) => void;
}

type Row = {
  id: NetworkKind;
  icon: TokenSymbol;
  title: string;
  unit?: string;
  address?: string;
  note?: string;
};

function shortAddress(address: string): string {
  if (address.length <= 18) return address;
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

const NetworkHoldings: React.FC<Props> = ({
  btcAddress,
  hemiAddress,
  solAddress,
  accountKind = 'software',
  refreshing,
  onCopyAddress,
}) => {
  const [amounts, setAmounts] = useState<Partial<Record<NetworkKind, string>>>({});
  const [failed, setFailed] = useState<Partial<Record<NetworkKind, boolean>>>({});
  const [loading, setLoading] = useState(false);
  const [send, setSend] = useState<NetworkKind | null>(null);
  const [tunnelOpen, setTunnelOpen] = useState(false);
  const [swapOpen, setSwapOpen] = useState(false);
  const request = useRef(0);

  const rows: Row[] = [
    {
      id: 'btc',
      icon: 'BTC',
      title: 'BTC',
      address: btcAddress,
      note: accountKind === 'ledger'
        ? 'Bitcoin needs the recovery phrase. This Nano cannot sign it here.'
        : 'Bitcoin needs the recovery phrase.',
    },
    {
      id: 'hemi',
      icon: 'HEMI',
      title: 'Hemi',
      unit: 'ETH',
      address: hemiAddress,
      note: accountKind === 'ledger'
        ? 'Add the Ethereum account above. Hemi uses that address.'
        : 'Hemi needs the recovery phrase.',
    },
    {
      id: 'sol',
      icon: 'SOL',
      title: 'SOL',
      address: solAddress,
      note: accountKind === 'ledger'
        ? 'Solana needs the recovery phrase. This Nano cannot sign it here.'
        : 'Solana needs the recovery phrase.',
    },
  ];

  const visible = rows.filter((row) => row.address || accountKind === 'ledger' || btcAddress || solAddress || hemiAddress);
  const phraseWallet = Boolean(btcAddress || solAddress);

  const load = useCallback(async () => {
    const id = ++request.current;
    const jobs: { kind: NetworkKind; run: Promise<string> }[] = [];
    if (btcAddress) jobs.push({ kind: 'btc', run: fetchBtcBalance(btcAddress).then(formatBtc) });
    if (hemiAddress) jobs.push({ kind: 'hemi', run: fetchHemiBalance(hemiAddress).then(formatHemi) });
    if (solAddress) jobs.push({ kind: 'sol', run: fetchSolBalance(solAddress).then(formatSol) });
    if (jobs.length === 0) {
      setAmounts({});
      setFailed({});
      setLoading(false);
      return;
    }
    setLoading(true);
    const settled = await Promise.all(jobs.map(async (job) => {
      try {
        return { kind: job.kind, amount: await job.run, ok: true };
      } catch {
        return { kind: job.kind, amount: '', ok: false };
      }
    }));
    if (id !== request.current) return;
    const nextAmounts: Partial<Record<NetworkKind, string>> = {};
    const nextFailed: Partial<Record<NetworkKind, boolean>> = {};
    for (const row of settled) {
      if (row.ok) nextAmounts[row.kind] = row.amount;
      else nextFailed[row.kind] = true;
    }
    setAmounts(nextAmounts);
    setFailed(nextFailed);
    setLoading(false);
  }, [btcAddress, hemiAddress, solAddress]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!refreshing) return;
    void load();
  }, [refreshing, load]);

  if (!phraseWallet && accountKind !== 'ledger' && !hemiAddress) {
    return (
      <View style={defiStyles.ethBlock}>
        <Text style={defiStyles.ethHoldingsLabel}>Networks</Text>
        <Text style={defiStyles.ethHoldingsHint}>
          Bitcoin, Hemi, and Solana come from the recovery phrase. A private-key import only has the Warthog account.
        </Text>
      </View>
    );
  }

  const sendAddress = send === 'btc' ? btcAddress : send === 'hemi' ? hemiAddress : solAddress;

  return (
    <View style={defiStyles.ethBlock}>
      <View style={defiStyles.ethHoldingsLabelRow}>
        <Text style={defiStyles.ethHoldingsLabel}>Networks</Text>
        {loading ? <ActivityIndicator size="small" color={theme.colors.primary} /> : null}
      </View>
      {visible.map((row) => (
        <View key={row.id} style={{ marginTop: 6 }}>
          <View style={defiStyles.ethHoldingRow}>
            <View style={defiStyles.ethSymbolGroup}>
              <TokenIcon symbol={row.icon} size={28} />
              <View>
                <Text style={defiStyles.ethHoldingSymbol}>{row.title}</Text>
                {row.unit ? <Text style={defiStyles.ethHoldingsHint}>{row.unit}</Text> : null}
              </View>
            </View>
            {!row.address || failed[row.id] ? (
              <Text style={defiStyles.ethHoldingAmount}>—</Text>
            ) : amounts[row.id] == null ? (
              <Text style={defiStyles.ethHoldingAmount}>…</Text>
            ) : (
              <FormattedNumber value={amounts[row.id]} variant="balance" style={defiStyles.ethHoldingAmount} />
            )}
          </View>
          {row.address ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <TouchableOpacity style={{ flex: 1 }} onPress={() => onCopyAddress(row.address || '')}>
                <Text style={[defiStyles.ethAddress, { marginTop: 0 }]} numberOfLines={1}>
                  {shortAddress(row.address)}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[defiStyles.ethActionBtn, { flex: 0, paddingHorizontal: 14 }]}
                onPress={() => setSend(row.id)}
              >
                <Text style={defiStyles.heroSendBtnText}>Send</Text>
              </TouchableOpacity>
              {row.id === 'hemi' && hemiAddress ? (
                <TouchableOpacity
                  style={[defiStyles.ethActionBtn, { flex: 0, paddingHorizontal: 14 }]}
                  onPress={() => setTunnelOpen(true)}
                >
                  <Text style={defiStyles.heroSendBtnText}>Tunnel</Text>
                </TouchableOpacity>
              ) : null}
              {row.id === 'sol' && solAddress ? (
                <TouchableOpacity
                  style={[defiStyles.ethActionBtn, { flex: 0, paddingHorizontal: 14 }]}
                  onPress={() => setSwapOpen(true)}
                >
                  <Text style={defiStyles.heroSendBtnText}>Swap</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : (
            <Text style={defiStyles.ethHoldingsHint}>{row.note}</Text>
          )}
        </View>
      ))}
      <Text style={[defiStyles.ethHoldingsHint, { marginTop: 8 }]}>
        {accountKind === 'ledger'
          ? 'Hemi uses the Ethereum account. Bitcoin and Solana stay on a recovery phrase.'
          : 'Same recovery phrase. Hemi uses the Ethereum address.'}
      </Text>
      <NetworkSendModal
        visible={send != null}
        kind={send}
        address={sendAddress || ''}
        onClose={() => setSend(null)}
        onSent={() => { void load(); }}
      />
      {hemiAddress ? (
        <HemiTunnelModal
          visible={tunnelOpen}
          btcAddress={btcAddress}
          hemiAddress={hemiAddress}
          ledger={accountKind === 'ledger'}
          onClose={() => setTunnelOpen(false)}
        />
      ) : null}
      {solAddress ? (
        <SolSwapModal
          visible={swapOpen}
          address={solAddress}
          onClose={() => setSwapOpen(false)}
          onSent={() => { void load(); }}
        />
      ) : null}
    </View>
  );
};

export default NetworkHoldings;
