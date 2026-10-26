import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { defiColors } from '../defi/defiStyles';
import { chainLabel, type WalletChain } from '../defi/walletChains';

function Card({ title, detail, onPress }: { title: string; detail: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={card} onPress={onPress} accessibilityRole="button">
      <Text style={cardTitle}>{title}</Text>
      <Text style={cardDetail}>{detail}</Text>
    </TouchableOpacity>
  );
}

/** Swap, SafeTrade, and Aave for the network selected above. */
export default function TradePane({
  chain,
  defi,
  canSwap,
  canSafeTrade,
  canAave,
  onSwap,
  onSafeTrade,
  onAave,
}: {
  chain: WalletChain;
  defi: boolean;
  canSwap: boolean;
  canSafeTrade: boolean;
  canAave: boolean;
  onSwap: () => void;
  onSafeTrade: () => void;
  onAave: () => void;
}) {
  const network = chain === 'wart' ? (defi ? 'Warthog DeFi Testnet' : 'Warthog Mainnet') : chainLabel(chain);
  return (
    <View>
      <Text style={pageTitle}>Trade</Text>
      <Text style={hint}>{network}</Text>
      {canSwap ? (
        <Card
          title="Swap"
          detail={chain === 'wart' ? 'Market and limit orders' : 'Swap, bridge, and cross-chain routes'}
          onPress={onSwap}
        />
      ) : null}
      {canSafeTrade ? (
        <Card
          title="SafeTrade"
          detail="Centralized exchange. Requires a SafeTrade account and API key."
          onPress={onSafeTrade}
        />
      ) : null}
      {canAave ? (
        <>
          <Text style={section}>Integrations</Text>
          <Card title="Aave" detail="Supply, borrow, repay, and withdraw on Ethereum." onPress={onAave} />
        </>
      ) : null}
      {!canSwap && !canSafeTrade && !canAave ? (
        <Text style={hint}>Choose another network to trade.</Text>
      ) : null}
      {chain === 'wart' && !defi ? (
        <Text style={hint}>Native swap, liquidity, and mint are on the DeFi testnet. Switch with the badge on the Warthog card.</Text>
      ) : null}
    </View>
  );
}

const pageTitle = { color: '#fafafa', fontSize: 19, fontWeight: '600' as const, marginBottom: 4 };
const section = {
  color: defiColors.textMuted,
  fontSize: 11,
  fontWeight: '600' as const,
  letterSpacing: 1.2,
  textTransform: 'uppercase' as const,
  marginTop: 18,
  marginBottom: 8,
};
const hint = { color: defiColors.textSecondary, fontSize: 12, marginBottom: 10 };
const card = {
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.08)',
  backgroundColor: 'rgba(255,255,255,0.03)',
  borderRadius: 14,
  padding: 14,
  marginBottom: 8,
};
const cardTitle = { color: '#fafafa', fontSize: 14, fontWeight: '600' as const };
const cardDetail = { color: defiColors.textSecondary, fontSize: 11, marginTop: 3 };
