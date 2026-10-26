import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { toast } from '../../utils/toast';
import { nodeRequest } from '../../utils/api';
import { submitCancelLimitOrder } from '../../utils/defiSubmit';
import { DEFAULT_FEE } from '../../constants';
import { defiColors, defiStyles } from '../defi/defiStyles';
import type { WalletChain } from '../defi/walletChains';
import type { WalletData } from '../../types';

type WartTab = 'history' | 'pending' | 'orders';

type MempoolEntry = {
  type?: string;
  transaction?: { hash?: string; data?: { amount?: { str?: string }; asset?: { name?: string }; name?: string; buy?: boolean } };
};

function pendingLabel(entry: MempoolEntry): string {
  const type = entry.type || 'transaction';
  const data = entry.transaction?.data;
  if (type === 'wartTransfer') return `Send ${data?.amount?.str || '?'} WART`;
  if (type === 'tokenTransfer') return `Send ${data?.amount?.str || '?'} ${data?.asset?.name || 'asset'}`;
  if (type === 'assetCreation') return `Create ${data?.name || 'asset'}`;
  if (type === 'limitSwap') return data?.buy ? 'Buy limit' : 'Sell limit';
  if (type === 'cancelation') return 'Cancel order';
  if (type === 'liquidityDeposit') return `Add ${data?.asset?.name || 'asset'} liquidity`;
  if (type === 'liquidityWithdrawal') return `Remove ${data?.asset?.name || 'asset'} liquidity`;
  return type;
}

function WartPending({
  address,
  node,
  wallet,
  nextNonce,
  canCancel,
  onNonceBump,
}: {
  address: string;
  node: string;
  wallet: WalletData;
  nextNonce: number;
  canCancel: boolean;
  onNonceBump: (nonce: number) => Promise<void>;
}) {
  const [rows, setRows] = useState<MempoolEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await nodeRequest<MempoolEntry[]>(node, `/account/${address}/mempool`);
    setRows(result.success && Array.isArray(result.data) ? result.data : []);
    setLoading(false);
  }, [address, node]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => { void load(); }, 15000);
    return () => clearInterval(timer);
  }, [load]);

  const cancel = async (hash: string) => {
    setCancelling(hash);
    try {
      const result = await submitCancelLimitOrder({
        node,
        wallet,
        nonceId: nextNonce,
        fee: DEFAULT_FEE,
        orderTxHash: hash,
      });
      await onNonceBump(result.nonce + 1);
      toast.success('Submitted', `Cancel tx: ${result.txHash.slice(0, 16)}…`);
      await load();
    } catch (err: unknown) {
      toast.error('Cancel failed', err instanceof Error ? err.message : 'Could not cancel');
    } finally {
      setCancelling(null);
    }
  };

  if (loading && rows.length === 0) return <ActivityIndicator color={defiColors.gold} style={{ marginTop: 24 }} />;
  if (rows.length === 0) return <Text style={defiStyles.emptyText}>No pending transactions</Text>;
  return (
    <View>
      {rows.map((entry, index) => {
        const hash = entry.transaction?.hash || '';
        return (
          <View key={hash || index} style={rowStyle}>
            <TouchableOpacity
              style={{ flex: 1 }}
              onPress={() => {
                if (!hash) return;
                void Clipboard.setStringAsync(hash);
                toast.success('Copied', 'Transaction hash copied');
              }}
            >
              <Text style={{ color: '#fafafa', fontWeight: '600' }}>{pendingLabel(entry)}</Text>
              <Text style={{ color: defiColors.amberText, fontSize: 12, marginTop: 2 }}>Pending</Text>
              {hash ? <Text style={{ color: defiColors.textMuted, fontSize: 11, marginTop: 2 }}>{hash.slice(0, 8)}…{hash.slice(-6)}</Text> : null}
            </TouchableOpacity>
            {canCancel && entry.type === 'limitSwap' && hash ? (
              <TouchableOpacity style={defiStyles.compactBtn} disabled={cancelling === hash} onPress={() => { void cancel(hash); }}>
                <Text style={defiStyles.compactBtnText}>{cancelling === hash ? '…' : 'Cancel'}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const rowStyle = {
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  gap: 8,
  paddingVertical: 12,
  borderBottomWidth: 1,
  borderBottomColor: 'rgba(255,255,255,0.06)',
};

/** History, pending Warthog transactions, and open orders, or the selected chain's activity. */
export default function ActivityPane({
  chain,
  defi,
  address,
  node,
  wallet,
  nextNonce,
  canCancelOrders,
  onNonceBump,
  history,
  orders,
  other,
}: {
  chain: WalletChain;
  defi: boolean;
  address: string;
  node: string;
  wallet: WalletData;
  nextNonce: number;
  canCancelOrders: boolean;
  onNonceBump: (nonce: number) => Promise<void>;
  history: React.ReactNode;
  orders: React.ReactNode;
  other: React.ReactNode;
}) {
  const [tab, setTab] = useState<WartTab>('history');
  useEffect(() => { setTab('history'); }, [chain]);
  const pills: { id: WartTab; label: string }[] = [
    { id: 'history', label: 'History' },
    { id: 'pending', label: 'Pending' },
    ...(defi ? [{ id: 'orders' as const, label: 'Open orders' }] : []),
  ];
  return (
    <View>
      <Text style={title}>Activity</Text>
      {chain === 'wart' ? (
        <>
          <View style={pillsRow}>
            {pills.map((pill) => {
              const on = tab === pill.id;
              return (
                <TouchableOpacity key={pill.id} style={[defiStyles.compactBtn, on && defiStyles.compactBtnActive]} onPress={() => setTab(pill.id)}>
                  <Text style={[defiStyles.compactBtnText, on && defiStyles.compactBtnTextActive]}>{pill.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {tab === 'history' ? history : null}
          {tab === 'pending' ? (
            <WartPending
              address={address}
              node={node}
              wallet={wallet}
              nextNonce={nextNonce}
              canCancel={canCancelOrders}
              onNonceBump={onNonceBump}
            />
          ) : null}
          {tab === 'orders' ? orders : null}
        </>
      ) : other}
    </View>
  );
}

const title = { color: '#fafafa', fontSize: 19, fontWeight: '600' as const, marginBottom: 12 };
const pillsRow = { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8, marginBottom: 12 };
