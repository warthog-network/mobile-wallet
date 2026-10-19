import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { defiStyles } from './defiStyles';
import FormattedNumber from '../FormattedNumber';
import EthHoldings from './EthHoldings';
import NetworkHoldings from './NetworkHoldings';
import ChainPicker from './ChainPicker';
import TokenIcon from '../TokenIcon';
import { NetworkModeBadge } from './WartMainnetHolding';
import type { WalletChain } from './walletChains';
import { hasPositiveLocked } from '../../utils/warthogFormat';
import type { WalletData } from '../../types';
import { theme } from '../../theme';

interface Props {
  wallet: WalletData;
  currentWalletName?: string;
  accountKind?: 'software' | 'ledger';
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
  onCopyAddress: (address: string) => void;
  onEthActivity?: () => void;
  onAddEthereum?: () => void;
  addingEthereum?: boolean;
  onAddBitcoin?: () => void;
  addingBitcoin?: boolean;
  onAddSolana?: () => void;
  addingSolana?: boolean;
  ethGeneration?: number;
  ethGenerationBlock?: number;
  chain: WalletChain;
  chains: WalletChain[];
  onChainChange: (chain: WalletChain) => void;
  solGeneration?: number;
  hemiGeneration?: number;
}

const DefiBalanceHero: React.FC<Props> = ({
  wallet,
  currentWalletName,
  accountKind = 'software',
  balance,
  balanceAvailable,
  balanceLocked,
  usdBalance,
  networkLabel = 'DeFi Testnet',
  refreshing,
  onRefresh,
  onCopyAddress,
  onEthActivity,
  onAddEthereum,
  addingEthereum,
  onAddBitcoin,
  addingBitcoin,
  onAddSolana,
  addingSolana,
  ethGeneration,
  ethGenerationBlock,
  chain,
  chains,
  onChainChange,
  solGeneration,
  hemiGeneration,
}) => {
  const selectedMainnet = chain === 'wart' ? networkLabel === 'Mainnet' : true;
  return (
  <View style={defiStyles.hero}>
    <View style={defiStyles.heroBody}>
      {currentWalletName ? (
        <View style={defiStyles.heroWalletLabel}>
          <View style={defiStyles.heroWalletDot} />
          <Text style={defiStyles.heroWalletText}>
            {accountKind === 'ledger' ? 'Ledger · ' : 'Saved as '}
            <Text style={defiStyles.heroWalletName}>{currentWalletName}</Text>
          </Text>
        </View>
      ) : null}

      <View style={defiStyles.heroTopRow}>
        <NetworkModeBadge mainnet={selectedMainnet} />
        <TouchableOpacity style={defiStyles.heroRefreshBtn} onPress={onRefresh} disabled={refreshing}>
          {refreshing ? (
            <ActivityIndicator size="small" color={theme.colors.primary} />
          ) : (
            <Text style={defiStyles.heroRefreshIcon}>⟳</Text>
          )}
          <Text style={defiStyles.heroRefreshText}>{refreshing ? 'Refreshing…' : 'Refresh'}</Text>
        </TouchableOpacity>
      </View>

      <ChainPicker chains={chains} value={chain} onChange={onChainChange} />

      {chain === 'wart' ? (
        <>
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
          <View style={defiStyles.heroActions}>
            <TouchableOpacity style={{ flex: 1 }} onPress={() => onCopyAddress(wallet.address)}>
              <Text style={defiStyles.heroAddress} numberOfLines={1}>
                {wallet.address.slice(0, 10)}…{wallet.address.slice(-8)}
              </Text>
            </TouchableOpacity>
          </View>
          {chains.length < 2 && accountKind !== 'ledger' ? (
            <Text style={[defiStyles.ethHoldingsHint, { marginTop: 10 }]}>
              Bitcoin, Ethereum, Hemi, and Solana come from the recovery phrase. A private-key import only has the Warthog account.
            </Text>
          ) : null}
        </>
      ) : null}

      {chain === 'ethereum' ? (
        wallet.ethAddress ? (
          <>
            <EthHoldings
              address={wallet.ethAddress}
              refreshing={refreshing}
              generation={ethGeneration}
              generationBlock={ethGenerationBlock}
              onActivity={onEthActivity}
            />
            <TouchableOpacity onPress={() => onCopyAddress(wallet.ethAddress || '')}>
              <Text style={defiStyles.ethAddress} numberOfLines={1}>
                {wallet.ethAddress.slice(0, 8)}…{wallet.ethAddress.slice(-6)}
              </Text>
            </TouchableOpacity>
          </>
        ) : (
          <View style={defiStyles.ethBlock}>
            <Text style={defiStyles.ethHoldingsLabel}>Ethereum</Text>
            <Text style={defiStyles.ethHoldingsHint}>
              Open the Ethereum app on the Nano and approve the address it shows. That address stays with this Ledger account.
            </Text>
            <TouchableOpacity
              style={[defiStyles.heroSendBtn, { marginTop: 8, alignSelf: 'flex-start' }]}
              onPress={onAddEthereum}
              disabled={addingEthereum || !onAddEthereum}
            >
              <Text style={defiStyles.heroSendBtnText}>
                {addingEthereum ? 'Approve on Ledger…' : 'Add Ethereum account'}
              </Text>
            </TouchableOpacity>
          </View>
        )
      ) : null}

      {chain === 'bitcoin' || chain === 'hemi' || chain === 'solana' ? (
        <NetworkHoldings
          chain={chain === 'bitcoin' ? 'btc' : chain === 'hemi' ? 'hemi' : 'sol'}
          btcAddress={wallet.btcAddress}
          hemiAddress={wallet.ethAddress}
          solAddress={wallet.solAddress}
          accountKind={accountKind}
          onAddAccount={chain === 'bitcoin' ? onAddBitcoin : chain === 'solana' ? onAddSolana : undefined}
          addingAccount={chain === 'bitcoin' ? addingBitcoin : chain === 'solana' ? addingSolana : false}
          refreshing={refreshing}
          solGeneration={solGeneration}
          hemiGeneration={hemiGeneration}
          onCopyAddress={onCopyAddress}
          onActivity={onEthActivity}
        />
      ) : null}
    </View>
  </View>
  );
};

export default DefiBalanceHero;
