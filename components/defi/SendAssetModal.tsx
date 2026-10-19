import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { toast } from '../../utils/toast';
import SpendConfirm, { useSpendFlow } from '../SpendConfirm';
import { defiStyles } from './defiStyles';
import DefiModalShell from './DefiModalShell';
import SpendableBalanceDisplay from '../SpendableBalanceDisplay';
import SelectDropdown from '../SelectDropdown';
import QrScannerModal from '../QrScannerModal';
import {
  amountExceedsAvailable,
  insufficientFreeBalanceMessage,
  isValidAssetHash,
  normalizeAssetHash,
} from '../../utils/warthogFormat';
import { isValidAddress } from '../../utils/crypto';
import { fetchAssetBalanceForAddress } from '../../utils/defiApi';
import { submitAssetTransfer } from '../../utils/defiSubmit';
import { DEFAULT_FEE } from '../../constants';
import type { AssetBalance, AssetPrefill, WalletData } from '../../types';
import { theme } from '../../theme';
import { isLedgerSession } from '../../utils/sessionVault';
import { LEDGER_DEFI_HOLD } from '../../utils/ledger/protocol';

type Spendable = {
  available: string;
  locked: string;
  total: string;
  hasLocked: boolean;
};

interface Props {
  visible: boolean;
  onClose: () => void;
  wallet: WalletData;
  selectedNode: string;
  nextNonce: number;
  assets?: AssetBalance[];
  prefill: AssetPrefill | null;
  onPrefillConsumed: () => void;
  onSuccess: (nonce: number) => Promise<void>;
}

const SendAssetModal: React.FC<Props> = ({
  visible,
  onClose,
  wallet,
  selectedNode,
  nextNonce,
  assets = [],
  prefill,
  onPrefillConsumed,
  onSuccess,
}) => {
  const [assetHash, setAssetHash] = useState('');
  const [assetName, setAssetName] = useState('');
  const [decimals, setDecimals] = useState('8');
  const [spendable, setSpendable] = useState<Spendable>({
    available: '',
    locked: '0',
    total: '',
    hasLocked: false,
  });
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [fee, setFee] = useState(DEFAULT_FEE);
  const flow = useSpendFlow();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [showQrScanner, setShowQrScanner] = useState(false);

  const applyAsset = useCallback((asset: {
    hash: string;
    name?: string;
    decimals?: number;
    available?: string;
    locked?: string;
    total?: string;
    balance?: string;
    hasLocked?: boolean;
  }) => {
    const hash = normalizeAssetHash(asset.hash);
    setAssetHash(hash);
    setAssetName(asset.name || '');
    setDecimals(String(asset.decimals ?? 8));
    const available = asset.available ?? asset.balance ?? '';
    const locked = asset.locked ?? '0';
    const total = asset.total ?? asset.balance ?? available;
    setSpendable({
      available,
      locked,
      total,
      hasLocked: Boolean(asset.hasLocked) || parseFloat(locked || '0') > 0,
    });
    setAmount('');
  }, []);

  useEffect(() => {
    if (!prefill) return;
    applyAsset(prefill);
    onPrefillConsumed();
  }, [prefill, onPrefillConsumed, applyAsset]);

  const loadAssetBalance = useCallback(
    async (hashRaw: string, { silent = false } = {}): Promise<Spendable | null> => {
      if (!wallet?.address || !selectedNode) return null;
      const hash = normalizeAssetHash(hashRaw);
      if (!isValidAssetHash(hash)) return null;

      if (!silent) setBalanceLoading(true);
      try {
        const bal = await fetchAssetBalanceForAddress(
          selectedNode,
          wallet.address,
          hash,
          assetName
        );
        const next: Spendable = {
          available: bal.available,
          locked: bal.locked,
          total: bal.balance,
          hasLocked: Boolean(bal.hasLocked),
        };
        setSpendable(next);
        if (bal.name) setAssetName(bal.name);
        setDecimals(String(bal.decimals));
        return next;
      } catch (err: any) {
        if (!silent) toast.error('Balance', err.message || 'Could not load asset balance');
        return null;
      } finally {
        if (!silent) setBalanceLoading(false);
      }
    },
    [wallet?.address, selectedNode, assetName]
  );

  useEffect(() => {
    if (!visible) return;
    const hash = normalizeAssetHash(assetHash);
    if (!wallet?.address || !isValidAssetHash(hash)) return undefined;
    const t = setTimeout(() => {
      loadAssetBalance(hash, { silent: true });
    }, 300);
    return () => clearTimeout(t);
  }, [visible, assetHash, wallet?.address, selectedNode, loadAssetBalance]);

  const assetOptions = useMemo(() => {
    const opts = assets.map((a) => ({ id: a.hash, label: a.name || a.hash.slice(0, 8) }));
    if (
      assetHash &&
      !assets.some((a) => a.hash.toLowerCase() === assetHash.toLowerCase())
    ) {
      opts.unshift({ id: assetHash, label: assetName || 'Selected asset' });
    }
    return opts;
  }, [assets, assetHash, assetName]);

  const freeBalance = spendable.available || spendable.total || '';

  const handlePickAsset = (hash: string) => {
    const match = assets.find((a) => a.hash.toLowerCase() === hash.toLowerCase());
    if (match) {
      applyAsset({
        hash: match.hash,
        name: match.name,
        decimals: match.decimals,
        available: match.available,
        locked: match.locked,
        total: match.balance,
        balance: match.balance,
        hasLocked: match.hasLocked,
      });
      return;
    }
    setAssetHash(hash);
  };

  const ledgerHold = isLedgerSession() ? LEDGER_DEFI_HOLD : null;

  const handleSend = async (confirmed = false) => {
    if (ledgerHold) {
      toast.error('Ledger', ledgerHold);
      return;
    }
    if (!assetHash || !recipient || !amount) {
      toast.error('Missing fields', 'Asset, recipient, and amount are required');
      return;
    }
    if (!isValidAssetHash(assetHash)) {
      toast.error('Invalid asset', 'Select a tracked token first');
      return;
    }
    if (!isValidAddress(recipient.trim())) {
      toast.error('Invalid address', 'Recipient must be a valid 48-char address');
      return;
    }

    if (!confirmed) {
      setConfirmOpen(true);
      return;
    }
    const amountStr = amount.trim();
    flow.begin(`Sending ${amountStr} ${assetName || 'tokens'}…`);
    try {
      const live = (await loadAssetBalance(assetHash, { silent: true })) || spendable;
      if (live?.available != null && amountExceedsAvailable(amountStr, live.available)) {
        const unit = assetName || 'tokens';
        const msg = insufficientFreeBalanceMessage({
          available: live.available,
          locked: live.locked,
          unit,
        });
        setAmount(live.available);
        flow.finish(false, 'Insufficient free balance', msg);
        return;
      }

      const result = await submitAssetTransfer({
        node: selectedNode,
        wallet,
        nonceId: nextNonce,
        fee,
        assetHash,
        toAddress: recipient,
        amount: amountStr,
        decimals: parseInt(decimals, 10) || 8,
        isLiquidity: false,
      });
      await onSuccess(result.nonce + 1);
      flow.finish(true, 'Sent', `${amountStr} ${assetName || 'tokens'} submitted. ${result.txHash.slice(0, 18)}…`);
      loadAssetBalance(assetHash, { silent: true });
    } catch (e: any) {
      let message = e.message || 'Transfer failed';
      if (/insufficient\s+(token\s+)?balance/i.test(message)) {
        message = insufficientFreeBalanceMessage({
          available: spendable.available,
          locked: spendable.locked,
          unit: assetName || 'tokens',
        });
      }
      flow.finish(false, 'Transfer failed', message);
    }
  };

  return (
    <>
      <DefiModalShell visible={visible} onClose={onClose} title="Send Asset">
        {ledgerHold ? <Text style={defiStyles.hintText}>{ledgerHold}</Text> : null}
        <Text style={defiStyles.label}>Asset</Text>
        <SelectDropdown
          value={assetHash}
          options={assetOptions}
          onChange={handlePickAsset}
          placeholder="Select token"
          accessibilityLabel="Asset"
          style={{ marginBottom: theme.spacing.md }}
        />
        {assets.length === 0 && !assetHash ? (
          <Text style={[defiStyles.hintText, { textAlign: 'left', marginTop: 0 }]}>
            Track a token on Overview or Search first.
          </Text>
        ) : null}

        <Text style={defiStyles.label}>To</Text>
        <View style={localStyles.addressRow}>
          <TextInput
            style={[defiStyles.input, localStyles.addressInput]}
            value={recipient}
            onChangeText={setRecipient}
            placeholder="Enter public address"
            placeholderTextColor={theme.colors.textMuted}
            autoCapitalize="none"
          />
          <TouchableOpacity style={localStyles.scanBtn} onPress={() => setShowQrScanner(true)}>
            <Text style={localStyles.scanBtnText}>📷</Text>
          </TouchableOpacity>
        </View>

        {balanceLoading ? (
          <ActivityIndicator color={theme.colors.primary} style={{ marginBottom: theme.spacing.sm }} />
        ) : freeBalance ? (
          <SpendableBalanceDisplay
            available={spendable.available || freeBalance}
            locked={spendable.locked}
            total={spendable.total || freeBalance}
            unit={assetName || undefined}
            label="Available"
            layout="stack"
          />
        ) : null}

        <Text style={defiStyles.label}>Amount</Text>
        <View style={localStyles.addressRow}>
          <TextInput
            style={[defiStyles.input, localStyles.addressInput]}
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor={theme.colors.textMuted}
          />
          {freeBalance && freeBalance !== '—' ? (
            <TouchableOpacity
              style={localStyles.scanBtn}
              onPress={() => setAmount(freeBalance)}
            >
              <Text style={localStyles.maxText}>Max</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <Text style={defiStyles.label}>Fee (WART)</Text>
        <TextInput
          style={defiStyles.input}
          value={fee}
          onChangeText={setFee}
          keyboardType="decimal-pad"
          placeholder={DEFAULT_FEE}
          placeholderTextColor={theme.colors.textMuted}
        />
        <TouchableOpacity style={defiStyles.btn} onPress={() => void handleSend(false)} disabled={flow.busy || Boolean(ledgerHold)}>
          <Text style={defiStyles.btnText}>{flow.busy ? 'Sending…' : 'Review send'}</Text>
        </TouchableOpacity>
      </DefiModalShell>
      <SpendConfirm
        open={confirmOpen}
        title="Confirm send asset"
        rows={[
          { label: 'Asset', value: assetName || assetHash || '—' },
          { label: 'To', value: recipient || '—' },
          { label: 'Amount', value: amount || '—' },
          { label: 'Fee', value: `${fee} WART` },
        ]}
        busy={flow.busy}
        step={flow.step}
        outcome={flow.outcome}
        confirmLabel="Send"
        onCancel={() => {
          const sent = flow.outcome?.ok;
          flow.close(() => {
            setRecipient('');
            setAmount('');
          });
          setConfirmOpen(false);
          if (sent) onClose();
        }}
        onConfirm={() => void handleSend(true)}
      />

      <QrScannerModal
        visible={showQrScanner}
        onClose={() => setShowQrScanner(false)}
        onScan={setRecipient}
      />
    </>
  );
};

const localStyles = StyleSheet.create({
  addressRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  addressInput: {
    flex: 1,
    marginBottom: 0,
  },
  scanBtn: {
    minWidth: 50,
    paddingHorizontal: 10,
    borderRadius: theme.borderRadius.sm,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(39, 39, 42, 0.8)',
    borderWidth: 1,
    borderColor: 'rgba(82, 82, 91, 0.5)',
  },
  scanBtnText: {
    fontSize: 20,
  },
  maxText: {
    color: theme.colors.textSecondary,
    fontSize: theme.typography.tiny,
    fontWeight: theme.typography.semiBold,
  },
});

export default SendAssetModal;
