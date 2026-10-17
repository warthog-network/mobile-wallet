import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { defiStyles } from './defiStyles';
import FormattedNumber from '../FormattedNumber';
import EthHoldings from './EthHoldings';
import TokenIcon from '../TokenIcon';
import { hasPositiveLocked } from '../../utils/warthogFormat';
import type { WalletData } from '../../types';
import { theme } from '../../theme';

interface Props {
  wallet: WalletData;
  currentWalletName?: string;
  /** Total holdings (for USD and locked-aware display). */
  balance: string;
  /** Free to spend; defaults to balance when omitted. */
  balanceAvailable?: string | null;
  /** Locked in open orders. */
  balanceLocked?: string | null;
  usdBalance: string;
  nodeLabel: string;
  networkLabel?: string;
  refreshing?: boolean;
  onRefresh: () => void;
  onSendWart: () => void;
  onShowAddressQr: () => void;
  onCopyAddress: (address: string) => void;
  onEthSwap?: () => void;
  onEthActivity?: () => void;
  ethGeneration?: number;
  ethGenerationBlock?: number;
}

const DefiBalanceHero: React.FC<Props> = ({
  wallet,
  currentWalletName,
  balance,
  balanceAvailable,
  balanceLocked,
  usdBalance,
  nodeLabel,
  networkLabel = 'DeFi Testnet',
  refreshing,
  onRefresh,
  onSendWart,
  onShowAddressQr,
  onCopyAddress,
  onEthSwap,
  onEthActivity,
  ethGeneration,
  ethGenerationBlock,
}) => (
  <View style={defiStyles.hero}>
    <View style={defiStyles.heroBody}>
      {currentWalletName ? (
        <View style={defiStyles.heroWalletLabel}>
          <View style={defiStyles.heroWalletDot} />
          <Text style={defiStyles.heroWalletText}>
            Saved as <Text style={defiStyles.heroWalletName}>{currentWalletName}</Text>
          </Text>
        </View>
      ) : null}

      <View style={defiStyles.heroTopRow}>
        <View style={{ flex: 1 }} />
        <TouchableOpacity style={defiStyles.heroRefreshBtn} onPress={onRefresh} disabled={refreshing}>
          {refreshing ? (
            <ActivityIndicator size="small" color={theme.colors.primary} />
          ) : (
            <Text style={defiStyles.heroRefreshIcon}>⟳</Text>
          )}
          <Text style={defiStyles.heroRefreshText}>{refreshing ? 'Refreshing…' : 'Refresh'}</Text>
        </TouchableOpacity>
      </View>

      <View style={defiStyles.ethHoldingRow}>
        <View style={defiStyles.ethSymbolGroup}>
          <TokenIcon symbol="WART" size={28} />
          <Text style={defiStyles.ethHoldingSymbol}>WART</Text>
        </View>
        <FormattedNumber
          value={balanceAvailable ?? balance}
          variant="balance"
          style={defiStyles.ethHoldingAmount}
        />
      </View>
      {hasPositiveLocked(balanceLocked) ? (
        <Text style={defiStyles.ethHoldingsHint}>
          Locked <FormattedNumber value={balanceLocked} variant="balance" style={defiStyles.ethHoldingsHint} />
          {' · '}
          Total <FormattedNumber value={balance} variant="balance" style={defiStyles.ethHoldingsHint} />
        </Text>
      ) : null}
      <Text style={defiStyles.heroUsd}>
        ≈ <FormattedNumber value={usdBalance} variant="number" /> USD
      </Text>
      <Text style={defiStyles.heroNode}>{nodeLabel} • {networkLabel}</Text>

      <View style={defiStyles.heroActions}>
        <TouchableOpacity style={defiStyles.heroSendBtn} onPress={onSendWart}>
          <Text style={defiStyles.heroSendBtnText}>Send WART</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={defiStyles.heroIconBtn}
          onPress={onShowAddressQr}
          accessibilityLabel="Show address QR code"
        >
          <Text style={defiStyles.heroIconBtnText}>QR</Text>
        </TouchableOpacity>
        <TouchableOpacity style={{ flex: 1 }} onPress={() => onCopyAddress(wallet.address)}>
          <Text style={defiStyles.heroAddress} numberOfLines={1}>
            {wallet.address.slice(0, 10)}…{wallet.address.slice(-8)}
          </Text>
        </TouchableOpacity>
      </View>
      {wallet.ethAddress ? (
        <>
          <EthHoldings
            address={wallet.ethAddress}
            refreshing={refreshing}
            generation={ethGeneration}
            generationBlock={ethGenerationBlock}
            onSwap={onEthSwap}
            onActivity={onEthActivity}
          />
          <TouchableOpacity onPress={() => onCopyAddress(wallet.ethAddress || '')}>
            <Text style={defiStyles.ethAddress} numberOfLines={1}>
              {wallet.ethAddress.slice(0, 8)}…{wallet.ethAddress.slice(-6)}
            </Text>
          </TouchableOpacity>
        </>
      ) : null}
    </View>
  </View>
);

export default DefiBalanceHero;
