import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { defiColors } from '../defi/defiStyles';
import { theme } from '../../theme';
import { explainExchangeFailure } from '../../utils/exchange/http';
import {
  clearSafeTradeCredentials,
  keyHint,
  loadSafeTradeCredentials,
  safeBalances,
  safeTicker,
  saveSafeTradeCredentials,
  type SafeTicker,
  type SpotBalance,
} from '../../utils/exchange/safetrade';
import SafeTradeCard from './SafeTradeCard';

function formatBalance(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const text = value.toFixed(8).replace(/\.?0+$/, '');
  return text || '0';
}

function balanceLine(rows: SpotBalance[], asset: string): string {
  const row = rows.find((item) => item.asset === asset);
  if (!row) return '0 free';
  const free = formatBalance(row.available);
  if (row.locked > 0) return `${free} free · ${formatBalance(row.locked)} locked`;
  return `${free} free`;
}

interface Props {
  wartAddress?: string;
  ethAddress?: string;
  node?: string;
  nextNonce?: number;
  walletWartFree?: string;
  walletWartLocked?: string;
  onWartSent?: (nextNonce: number) => void;
}

const SafeTradeTool: React.FC<Props> = ({
  wartAddress = '',
  ethAddress = '',
  node = '',
  nextNonce = 0,
  walletWartFree = '',
  walletWartLocked = '',
  onWartSent = () => {},
}) => {
  const [apiKey, setApiKey] = useState('');
  const [secret, setSecret] = useState('');
  const [savedHint, setSavedHint] = useState('');
  const [busy, setBusy] = useState(false);
  const [ticker, setTicker] = useState<SafeTicker | null>(null);
  const [tickerError, setTickerError] = useState('');
  const [rows, setRows] = useState<SpotBalance[] | null>(null);
  const [checkError, setCheckError] = useState('');

  const refreshTicker = useCallback(async () => {
    try {
      const next = await safeTicker();
      setTicker(next);
      setTickerError('');
    } catch (err) {
      setTicker(null);
      const message = explainExchangeFailure(err);
      setTickerError(
        /blocked|browser|failed to fetch/i.test(message)
          ? 'This browser cannot read SafeTrade. Check the key from the phone app.'
          : message,
      );
    }
  }, []);

  useEffect(() => {
    let cancel = false;
    void (async () => {
      const saved = await loadSafeTradeCredentials();
      if (cancel) return;
      setSavedHint(saved ? keyHint(saved.apiKey) : '');
    })();
    void refreshTicker();
    return () => {
      cancel = true;
    };
  }, [refreshTicker]);

  const checkBalances = async () => {
    setBusy(true);
    setCheckError('');
    setRows(null);
    try {
      let creds = await loadSafeTradeCredentials();
      const typedKey = apiKey.trim();
      const typedSecret = secret.trim();
      if (typedKey || typedSecret) {
        if (!typedKey || !typedSecret) {
          throw new Error('Enter both the API key and the secret, then check again.');
        }
        creds = { apiKey: typedKey, secret: typedSecret };
        await saveSafeTradeCredentials(creds);
        setSavedHint(keyHint(typedKey));
        setApiKey('');
        setSecret('');
      }
      if (!creds) {
        throw new Error('Save a SafeTrade API key and secret first.');
      }
      const balances = await safeBalances(creds);
      setRows(balances);
    } catch (err) {
      setCheckError(explainExchangeFailure(err));
    } finally {
      setBusy(false);
    }
  };

  const forgetKey = async () => {
    setBusy(true);
    try {
      await clearSafeTradeCredentials();
      setSavedHint('');
      setApiKey('');
      setSecret('');
      setRows(null);
      setCheckError('');
    } catch (err) {
      setCheckError(explainExchangeFailure(err));
    } finally {
      setBusy(false);
    }
  };

  const others = (rows ?? []).filter(
    (row) => row.asset !== 'WART' && row.asset !== 'USDT' && (row.available > 0 || row.locked > 0),
  );

  return (
    <View>
      <Text style={styles.panelTitle}>SafeTrade</Text>
      <Text style={styles.panelDesc}>
        Checks the WART/USDT account on safe.trade. The key stays on this device.
        {Platform.OS === 'web'
          ? ' In this browser the balance check leaves as this computer’s IPv4. That IPv4 has to be trusted on the API key.'
          : ' SafeTrade accepts the call only from a trusted IPv4. Use the whitelisted Wi-Fi with VPN off.'}
      </Text>

      <Text style={styles.marketLine}>
        {ticker
          ? `${ticker.market} ${ticker.last}${ticker.change ? ` (${ticker.change})` : ''}`
          : tickerError || 'Loading WART/USDT…'}
      </Text>

      {savedHint ? (
        <Text style={styles.saved}>Key on this device {savedHint}</Text>
      ) : (
        <Text style={styles.panelDesc}>No SafeTrade key saved on this device yet.</Text>
      )}

      <Text style={styles.inputLabel}>API key</Text>
      <TextInput
        style={styles.input}
        value={apiKey}
        onChangeText={setApiKey}
        placeholder={savedHint ? 'Paste a new key to replace' : 'SafeTrade API key'}
        placeholderTextColor={defiColors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!busy}
      />
      <Text style={styles.inputLabel}>Secret</Text>
      <TextInput
        style={styles.input}
        value={secret}
        onChangeText={setSecret}
        placeholder={savedHint ? 'Paste the secret with the new key' : 'HMAC secret'}
        placeholderTextColor={defiColors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        editable={!busy}
      />

      <TouchableOpacity
        style={[styles.actionBtn, styles.actionBtnBlock, busy && styles.actionBtnDisabled]}
        onPress={() => void checkBalances()}
        disabled={busy}
      >
        {busy ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.actionBtnText}>
            {apiKey.trim() || secret.trim() ? 'Save and check balances' : 'Check balances'}
          </Text>
        )}
      </TouchableOpacity>

      {savedHint ? (
        <TouchableOpacity
          style={[styles.actionBtnSecondary, busy && styles.actionBtnDisabled]}
          onPress={() => void forgetKey()}
          disabled={busy}
        >
          <Text style={styles.actionBtnSecondaryText}>Remove saved key</Text>
        </TouchableOpacity>
      ) : null}

      {rows ? (
        <View style={[styles.resultBox, styles.resultOk]}>
          <Text style={styles.resultOkText}>SafeTrade accepted this address</Text>
          <Text style={styles.resultMeta}>WART</Text>
          <Text style={styles.resultAddress}>{balanceLine(rows, 'WART')}</Text>
          <Text style={styles.resultMeta}>USDT</Text>
          <Text style={styles.resultAddress}>{balanceLine(rows, 'USDT')}</Text>
          {others.map((row) => (
            <Text key={row.asset} style={styles.resultHint}>
              {row.asset} {balanceLine([row], row.asset)}
            </Text>
          ))}
        </View>
      ) : null}

      {checkError ? (
        <View style={[styles.resultBox, styles.resultErr]}>
          <Text style={styles.resultErrText}>{checkError}</Text>
        </View>
      ) : null}

      <SafeTradeCard
        rows={rows}
        onRows={setRows}
        lastPrice={ticker?.last ?? ''}
        wartAddress={wartAddress}
        ethAddress={ethAddress}
        node={node}
        nextNonce={nextNonce}
        walletWartFree={walletWartFree}
        walletWartLocked={walletWartLocked}
        onWartSent={onWartSent}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  panelTitle: {
    color: theme.colors.textPrimary,
    fontSize: theme.typography.body,
    fontWeight: theme.typography.semiBold,
    marginBottom: 4,
  },
  panelDesc: {
    color: defiColors.textMuted,
    fontSize: theme.typography.caption,
    marginBottom: theme.spacing.md,
    lineHeight: 18,
  },
  marketLine: {
    color: theme.colors.textPrimary,
    fontSize: theme.typography.caption,
    fontFamily: theme.typography.fontFamily.mono,
    marginBottom: theme.spacing.md,
  },
  saved: {
    color: defiColors.gold,
    fontWeight: theme.typography.semiBold,
    fontSize: theme.typography.caption,
    marginBottom: theme.spacing.md,
  },
  inputLabel: {
    color: defiColors.textSecondary,
    fontSize: theme.typography.caption,
    marginBottom: theme.spacing.sm,
  },
  input: {
    backgroundColor: defiColors.bgCard,
    color: theme.colors.textPrimary,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: defiColors.border,
    marginBottom: theme.spacing.md,
    fontSize: theme.typography.bodySm,
    fontFamily: theme.typography.fontFamily.mono,
  },
  actionBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: defiColors.goldHover,
    borderWidth: 1,
    borderColor: defiColors.goldHover,
  },
  actionBtnBlock: {
    alignSelf: 'stretch',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
  },
  actionBtnSecondary: {
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: 'rgba(113, 113, 122, 0.75)',
    backgroundColor: 'rgba(63, 63, 70, 0.45)',
  },
  actionBtnSecondaryText: {
    color: defiColors.textSecondary,
    fontWeight: theme.typography.semiBold,
    fontSize: theme.typography.caption,
  },
  actionBtnDisabled: {
    opacity: 0.4,
  },
  actionBtnText: {
    color: '#fff',
    fontWeight: theme.typography.semiBold,
    fontSize: theme.typography.caption,
  },
  resultBox: {
    marginTop: theme.spacing.md,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
  },
  resultOk: {
    borderColor: defiColors.border,
    backgroundColor: 'rgba(24, 24, 27, 0.6)',
  },
  resultErr: {
    borderColor: 'rgba(248, 113, 113, 0.4)',
    backgroundColor: 'rgba(127, 29, 29, 0.2)',
  },
  resultOkText: {
    color: defiColors.gold,
    fontWeight: theme.typography.semiBold,
    marginBottom: theme.spacing.sm,
  },
  resultMeta: {
    color: defiColors.textMuted,
    fontSize: 10,
    marginBottom: 4,
    marginTop: 6,
  },
  resultAddress: {
    color: theme.colors.textPrimary,
    fontFamily: theme.typography.fontFamily.mono,
    fontSize: theme.typography.caption,
  },
  resultHint: {
    color: defiColors.textMuted,
    fontSize: 10,
    marginTop: theme.spacing.sm,
  },
  resultErrText: {
    color: '#f87171',
    fontSize: theme.typography.caption,
    lineHeight: 18,
  },
});

export default SafeTradeTool;
