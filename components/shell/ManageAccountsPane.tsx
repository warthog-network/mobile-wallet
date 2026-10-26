import React, { useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { defiColors, defiStyles } from '../defi/defiStyles';
import type { AccountChoice } from './WalletChrome';

/** Saved wallets and Ledger names. Switching opens that account's unlock screen. */
export default function ManageAccountsPane({
  accounts,
  accountId,
  onBack,
  onSwitch,
  onNewWallet,
}: {
  accounts: AccountChoice[];
  accountId: string;
  onBack: () => void;
  onSwitch: (id: string) => void;
  onNewWallet: () => void;
}) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const visible = accounts.filter((account) => {
    if (!needle) return true;
    return account.name.toLowerCase().includes(needle) || (account.detail || '').toLowerCase().includes(needle);
  });

  return (
    <View>
      <TouchableOpacity onPress={onBack} accessibilityRole="button" accessibilityLabel="Back to settings">
        <Text style={back}>‹ Settings</Text>
      </TouchableOpacity>
      <Text style={title}>Manage accounts</Text>
      <Text style={hint}>Switch a saved wallet or a Ledger name. Each saved name is its own key on this phone.</Text>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search"
        placeholderTextColor="#71717a"
        autoCapitalize="none"
        autoCorrect={false}
        style={defiStyles.input}
        accessibilityLabel="Search accounts"
      />
      {visible.length ? visible.map((account) => {
        const on = account.id === accountId;
        return (
          <TouchableOpacity
            key={account.id}
            style={[row, on && rowOn]}
            onPress={() => { if (!on) onSwitch(account.id); }}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
          >
            <Text style={[rowTitle, on && { color: '#fafafa' }]} numberOfLines={1}>{account.name}</Text>
            {account.detail ? <Text style={rowDetail}>{account.detail}</Text> : null}
          </TouchableOpacity>
        );
      }) : (
        <Text style={empty}>No accounts found</Text>
      )}
      <TouchableOpacity style={[row, { marginTop: 16 }]} onPress={onNewWallet} accessibilityRole="button" accessibilityLabel="New wallet">
        <Text style={[rowTitle, { color: defiColors.gold }]}>New wallet</Text>
        <Text style={rowDetail}>Create or import another wallet from the start screen.</Text>
      </TouchableOpacity>
    </View>
  );
}

const back = { color: '#FDB913', fontSize: 13, fontWeight: '600' as const, marginBottom: 12 };
const title = { color: '#fafafa', fontSize: 19, fontWeight: '600' as const, marginBottom: 8 };
const hint = { color: defiColors.textSecondary, fontSize: 12, marginBottom: 12, lineHeight: 18 };
const empty = { color: '#71717a', fontSize: 13, textAlign: 'center' as const, marginTop: 18 };
const row = {
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.08)',
  backgroundColor: 'rgba(255,255,255,0.03)',
  borderRadius: 14,
  padding: 14,
  marginBottom: 8,
};
const rowOn = { borderColor: 'rgba(253,185,19,0.7)', backgroundColor: 'rgba(253,185,19,0.08)' };
const rowTitle = { color: '#fafafa', fontSize: 14, fontWeight: '600' as const };
const rowDetail = { color: defiColors.textSecondary, fontSize: 11, marginTop: 3 };
