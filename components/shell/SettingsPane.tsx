import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import NumberDisplaySettings from '../tools/NumberDisplaySettings';
import PrivacySection from '../PrivacySection';
import { defiColors, defiStyles } from '../defi/defiStyles';
import { AUTO_LOCK_CHOICES, saveAutoLockMinutes, type AutoLockMinutes } from '../../utils/autoLock';
import type { NodeSelection, WalletNode } from '../../utils/nodeCatalog';
import type { AccountChoice } from './WalletChrome';
import AccountNamePane from './AccountNamePane';
import ManageAccountsPane from './ManageAccountsPane';
import NodeSettings from './NodeSettings';

export type SettingsScreen = 'menu' | 'account' | 'accounts' | 'nodes';

function Card({ title, detail, onPress, label }: { title: string; detail: string; onPress: () => void; label?: string }) {
  return (
    <TouchableOpacity style={card} onPress={onPress} accessibilityRole="button" accessibilityLabel={label || title}>
      <Text style={cardTitle}>{title}</Text>
      <Text style={cardDetail}>{detail}</Text>
    </TouchableOpacity>
  );
}

/** Account, nodes, display, and the tools that are not a trade. */
export default function SettingsPane({
  screen,
  onScreen,
  walletName,
  ledger,
  saved,
  deleting,
  accounts,
  accountId,
  onRename,
  onSwitchAccount,
  onNewWallet,
  onSaveDevice,
  onDownload,
  onDelete,
  nodes,
  selection,
  activeUrl,
  onSelectNode,
  onChangeNodes,
  lockMinutes,
  onLockMinutes,
  onPasskey,
  onPhrase,
  onContacts,
  onValidate,
}: {
  screen: SettingsScreen;
  onScreen: (screen: SettingsScreen) => void;
  walletName: string;
  ledger: boolean;
  saved: boolean;
  deleting?: boolean;
  accounts: AccountChoice[];
  accountId: string;
  onRename: (name: string) => Promise<void>;
  onSwitchAccount: (id: string) => void;
  onNewWallet: () => void;
  onSaveDevice?: () => void;
  onDownload?: () => void;
  onDelete?: () => void;
  nodes: WalletNode[];
  selection: NodeSelection;
  activeUrl: string;
  onSelectNode: (node: WalletNode) => void;
  onChangeNodes: (nodes: WalletNode[]) => void;
  lockMinutes: AutoLockMinutes;
  onLockMinutes: (minutes: AutoLockMinutes) => void;
  onPasskey?: () => void;
  onPhrase?: () => void;
  onContacts: () => void;
  onValidate: () => void;
}) {
  if (screen === 'account') {
    return (
      <AccountNamePane
        name={walletName}
        ledger={ledger}
        saved={saved}
        deleting={deleting}
        onBack={() => onScreen('menu')}
        onRename={onRename}
        onSaveDevice={onSaveDevice}
        onDownload={onDownload}
        onDelete={onDelete}
      />
    );
  }
  if (screen === 'accounts') {
    return (
      <ManageAccountsPane
        accounts={accounts}
        accountId={accountId}
        onBack={() => onScreen('menu')}
        onSwitch={onSwitchAccount}
        onNewWallet={onNewWallet}
      />
    );
  }
  if (screen === 'nodes') {
    return (
      <NodeSettings
        nodes={nodes}
        selection={selection}
        activeUrl={activeUrl}
        onBack={() => onScreen('menu')}
        onSelect={onSelectNode}
        onChange={onChangeNodes}
      />
    );
  }
  return (
    <View>
      <Text style={pageTitle}>Settings</Text>
      <Text style={section}>Account and security</Text>
      <Card
        title={walletName || 'Wallet'}
        detail="Rename this account"
        label={`Rename ${walletName || 'Wallet'}`}
        onPress={() => onScreen('account')}
      />
      <Card
        title="Manage accounts"
        detail="Switch saved wallets and Ledger names"
        onPress={() => onScreen('accounts')}
      />
      {onPasskey ? <Card title="Passkey and 2FA" detail="Unlock with biometrics, and optionally require the password too." onPress={onPasskey} /> : null}
      {onPhrase ? <Card title="Recovery phrase" detail="Back up every address this phrase can open. Keep it secret." onPress={onPhrase} /> : null}
      <Text style={hint}>Lock after leaving the app</Text>
      <View style={chipRow}>
        {AUTO_LOCK_CHOICES.map((minutes) => {
          const on = lockMinutes === minutes;
          return (
            <TouchableOpacity
              key={minutes}
              style={[defiStyles.compactBtn, on && defiStyles.compactBtnActive]}
              onPress={() => {
                onLockMinutes(minutes);
                void saveAutoLockMinutes(minutes);
              }}
            >
              <Text style={[defiStyles.compactBtnText, on && defiStyles.compactBtnTextActive]}>{minutes} min</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={section}>Networks</Text>
      <Card
        title="Warthog nodes"
        detail="RPC endpoints for Mainnet and DeFi Testnet"
        onPress={() => onScreen('nodes')}
      />
      <Text style={section}>Display</Text>
      <NumberDisplaySettings collapsible />
      <Text style={section}>Address book</Text>
      <Card title="Contacts" detail="Names for addresses you send to." onPress={onContacts} />
      <Card title="Validate address" detail="Check a Warthog address on this phone. Nothing is sent." onPress={onValidate} />
      <PrivacySection />
    </View>
  );
}

const pageTitle = { color: '#fafafa', fontSize: 19, fontWeight: '600' as const, marginBottom: 8 };
const section = {
  color: defiColors.textMuted,
  fontSize: 11,
  fontWeight: '600' as const,
  letterSpacing: 1.2,
  textTransform: 'uppercase' as const,
  marginTop: 18,
  marginBottom: 8,
};
const hint = { color: defiColors.textSecondary, fontSize: 12, marginBottom: 8 };
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
const chipRow = { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 };
