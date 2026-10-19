import React, { useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import TokenIcon, { tokenMark } from '../TokenIcon';
import DefiModalShell from './DefiModalShell';
import { defiColors } from './defiStyles';
import { swapPanelStyles as styles } from './swapPanelStyles';
import { addCustomToken, removeCustomToken, type TokenNetwork, type WalletToken } from '../../utils/walletTokens';

interface ExtraChoice {
  id: string;
  symbol: string;
  name: string;
}

interface Props {
  visible: boolean;
  network: TokenNetwork;
  tokens: WalletToken[];
  title?: string;
  /** When set, a row selects that token. Custom rows can still be removed. */
  onSelect?: (token: WalletToken) => void;
  extra?: ExtraChoice[];
  onExtra?: (id: string) => void;
  onClose: () => void;
  /** Bitcoin has no token list. Other networks can add a contract or mint. */
  allowAdd?: boolean;
}

/** Pick a listed token, or add one after the chain reports its symbol and decimals. */
const TokenPickModal: React.FC<Props> = ({
  visible,
  network,
  tokens,
  title = 'Choose asset',
  onSelect,
  extra,
  onExtra,
  onClose,
  allowAdd = true,
}) => {
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (busy || !address.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const token = await addCustomToken(network, address);
      setAddress('');
      onSelect?.(token);
      if (onSelect) onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not add that token.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <DefiModalShell visible={visible} onClose={onClose} title={title} subtitle={networkLabel(network)}>
      {tokens.map((token) => (
        <View key={token.id} style={rowStyle}>
          <TouchableOpacity
            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}
            onPress={onSelect ? () => { onSelect(token); onClose(); } : undefined}
            disabled={!onSelect}
          >
            <TokenIcon symbol={tokenMark(token.symbol, network, token.native)} size={28} />
            <View style={{ flex: 1 }}>
              <Text style={styles.tokenPillText}>{token.symbol}</Text>
              <Text style={hint} numberOfLines={1}>{token.name}</Text>
            </View>
          </TouchableOpacity>
          {token.custom ? (
            <TouchableOpacity onPress={() => { void removeCustomToken(network, token.address); }}>
              <Text style={styles.hint}>Remove</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ))}
      {extra?.map((choice) => (
        <TouchableOpacity
          key={choice.id}
          style={rowStyle}
          onPress={() => { onExtra?.(choice.id); onClose(); }}
        >
          <TokenIcon symbol={choice.symbol} size={28} />
          <View style={{ flex: 1 }}>
            <Text style={styles.tokenPillText}>{choice.symbol}</Text>
            <Text style={hint}>{choice.name}</Text>
          </View>
        </TouchableOpacity>
      ))}
      {allowAdd ? (
        <View style={{ marginTop: 12, gap: 8 }}>
          <Text style={styles.mutedLabel}>Add a token on this network</Text>
          <TextInput
            style={input}
            value={address}
            onChangeText={(text) => { setAddress(text.trim()); setError(null); }}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={network === 'solana' ? 'Mint address' : 'Contract address 0x…'}
            placeholderTextColor="#3f3f46"
          />
          {error ? <Text style={styles.warn}>{error}</Text> : null}
          <TouchableOpacity
            style={[styles.cta, (!address.trim() || busy) && styles.ctaDisabled]}
            disabled={!address.trim() || busy}
            onPress={() => { void add(); }}
          >
            <Text style={styles.ctaText}>{busy ? 'Checking the token…' : 'Add token'}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </DefiModalShell>
  );
};

function networkLabel(network: TokenNetwork): string {
  if (network === 'ethereum') return 'Ethereum mainnet';
  if (network === 'hemi') return 'Hemi';
  return 'Solana';
}

const rowStyle = {
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  gap: 8,
  paddingVertical: 8,
  borderBottomWidth: 1,
  borderBottomColor: 'rgba(39, 39, 42, 0.8)',
};

const hint = {
  color: defiColors.textMuted,
  fontSize: 11,
  marginTop: 2,
};

const input = {
  color: '#fff',
  fontSize: 14,
  borderWidth: 1,
  borderColor: 'rgba(113, 113, 122, 0.9)',
  borderRadius: 10,
  paddingHorizontal: 10,
  paddingVertical: 8,
};

export default TokenPickModal;
