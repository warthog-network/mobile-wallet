import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { defiColors } from './defi/defiStyles';
import { theme } from '../theme';

const PARAGRAPHS = [
  'Warthog Wallet is non-custodial. The seed phrase, private key, and wallet password stay on this phone, encrypted in local storage. There is no account on a Warthog server, and the app does not use analytics or an advertising ID.',
  'The Warthog node you select receives your address and the transactions you submit. The default mainnet node is warthognode.duckdns.org. On the DeFi testnet, asset names and icons also load from that network’s metadata server.',
  'Ethereum balances and sends use ethereum.publicnode.com. Ethereum and Hemi activity use api.routescan.io. Bitcoin activity uses mempool.space. Solana activity uses the Solana RPC. Those calls include the address on that network and, when you send, the transaction you broadcast.',
  'The WART price request goes to api.coingecko.com and does not include your address.',
  'The camera is used only when you scan a QR code. The picture stays on the phone. A Ledger connection uses USB. The phone stores the public address, not the key. Wallet names, contacts, and the encrypted wallet file stay on the phone.',
  'Remove a saved wallet from Wallet Options. Uninstalling the app removes what this phone stored. There is no remote account to delete.',
];

/** Shown from Wallet Options. */
const PrivacySection: React.FC = () => {
  return (
    <View style={styles.section}>
      <Text style={styles.title}>Privacy</Text>
      {PARAGRAPHS.map((line) => (
        <Text key={line} style={styles.body}>
          {line}
        </Text>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  section: {
    marginBottom: theme.spacing.lg,
  },
  title: {
    color: defiColors.textSecondary,
    fontSize: theme.typography.caption,
    fontWeight: theme.typography.semiBold,
    marginBottom: theme.spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  body: {
    color: defiColors.textMuted,
    fontSize: theme.typography.caption,
    lineHeight: 18,
    marginBottom: theme.spacing.sm,
  },
});

export default PrivacySection;
