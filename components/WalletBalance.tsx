import React from 'react';
import { View, Text, StyleSheet, RefreshControl, ScrollView, Picker } from 'react-native';
import { Card } from './Card';
import { Button } from './Button';
import { LoadingSkeleton, BalanceSkeleton } from './LoadingSkeleton';
import { theme } from '../theme';
import { e8ToWart, abbreviate } from '../utils/crypto';

interface WalletBalanceProps {
  wallet: any;
  balance: {
    balance: string;
    nonce: number;
  };
  usdBalance: number;
  nextNonce: number;
  currentBlockHeight: number;
  selectedNode: string;
  nodes: string[];
  refreshing: boolean;
  onRefresh: () => void;
  onNodeChange: (node: string) => void;
  onShowWallet: () => void;
  onLogout: () => void;
  onClearWallet: () => void;
  onDownloadWallet: () => void;
  loading?: boolean;
}

export const WalletBalance: React.FC<WalletBalanceProps> = ({
  wallet,
  balance,
  usdBalance,
  nextNonce,
  currentBlockHeight,
  selectedNode,
  nodes,
  refreshing,
  onRefresh,
  onNodeChange,
  onShowWallet,
  onLogout,
  onClearWallet,
  onDownloadWallet,
  loading = false
}) => {
  if (!wallet) return null;

  const wartBalance = e8ToWart(balance.balance);
  const formattedUsdBalance = usdBalance.toFixed(2);

  return (
    <ScrollView
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={theme.colors.primary}
          colors={[theme.colors.primary]}
        />
      }
    >
      <View style={styles.container}>
        {/* Balance Card */}
        <Card variant="glass" style={styles.balanceCard}>
          {loading ? (
            <BalanceSkeleton />
          ) : (
            <>
              <Text style={styles.balanceLabel}>Balance</Text>
              <Text style={styles.balanceValue}>
                {parseFloat(wartBalance).toLocaleString()} WART
              </Text>
              <Text style={styles.balanceUsd}>
                ≈ ${formattedUsdBalance} USD
              </Text>
            </>
          )}
        </Card>

        {/* Wallet Info Card */}
        <Card variant="solid" style={styles.infoCard}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Address:</Text>
            <Text style={styles.infoValue}>{abbreviate(wallet.address)}</Text>
          </View>
          
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Next Nonce:</Text>
            <Text style={styles.infoValue}>{nextNonce}</Text>
          </View>
          
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Block Height:</Text>
            <Text style={styles.infoValue}>{currentBlockHeight.toLocaleString()}</Text>
          </View>
        </Card>

        {/* Node Selection */}
        <Card variant="solid" style={styles.nodeCard}>
          <Text style={styles.nodeLabel}>Warthog Node</Text>
          <View style={styles.pickerContainer}>
            <Picker
              selectedValue={selectedNode}
              onValueChange={onNodeChange}
              style={styles.picker}
              dropdownIconColor={theme.colors.primary}
            >
              {nodes.map((node) => (
                <Picker.Item
                  key={node}
                  label={node}
                  value={node}
                  color={theme.colors.text}
                />
              ))}
            </Picker>
          </View>
        </Card>

        {/* Action Buttons */}
        <View style={styles.actionButtons}>
          <Button
            title="Show Wallet"
            variant="outline"
            onPress={onShowWallet}
            style={styles.actionButton}
          />
          <Button
            title="Download"
            variant="outline"
            onPress={onDownloadWallet}
            style={styles.actionButton}
          />
        </View>

        <View style={styles.actionButtons}>
          <Button
            title="Logout"
            variant="secondary"
            onPress={onLogout}
            style={styles.actionButton}
          />
          <Button
            title="Clear Wallet"
            variant="danger"
            onPress={onClearWallet}
            style={styles.actionButton}
          />
        </View>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: theme.spacing.medium,
    gap: theme.spacing.medium,
  },
  balanceCard: {
    padding: theme.spacing.large,
    alignItems: 'center',
  },
  balanceLabel: {
    color: theme.colors.textSecondary,
    fontSize: 16,
    marginBottom: theme.spacing.small,
  },
  balanceValue: {
    color: theme.colors.primary,
    fontSize: 32,
    fontWeight: 'bold',
    textShadowColor: theme.colors.primary,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  balanceUsd: {
    color: theme.colors.textSecondary,
    fontSize: 18,
    marginTop: theme.spacing.small,
  },
  infoCard: {
    padding: theme.spacing.medium,
    gap: theme.spacing.small,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  infoLabel: {
    color: theme.colors.textSecondary,
    fontSize: 14,
  },
  infoValue: {
    color: theme.colors.text,
    fontSize: 14,
    fontFamily: 'monospace',
  },
  nodeCard: {
    padding: theme.spacing.medium,
  },
  nodeLabel: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: '500',
    marginBottom: theme.spacing.small,
  },
  pickerContainer: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.medium,
    backgroundColor: theme.colors.background,
  },
  picker: {
    color: theme.colors.text,
    backgroundColor: 'transparent',
  },
  actionButtons: {
    flexDirection: 'row',
    gap: theme.spacing.small,
  },
  actionButton: {
    flex: 1,
  },
});
