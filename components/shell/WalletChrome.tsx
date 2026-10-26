import React, { useEffect, useRef, useState } from 'react';
import { Animated, Modal, Pressable, Text, TouchableOpacity, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import ChainPicker from '../defi/ChainPicker';
import { defiColors, defiStyles } from '../defi/defiStyles';
import TokenIcon from '../TokenIcon';
import { chainLabel, shortAddress, type WalletChain } from '../defi/walletChains';

const GOLD = defiColors.gold;
const MUTED = '#71717a';

const icon = (paths: string, color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="none" stroke="${color}" stroke-width="32" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

const LOCK = icon('<rect x="128" y="224" width="256" height="192" rx="40"/><path d="M336 224v-72a80 80 0 00-160 0v72"/>', '#a1a1aa');
const GEAR = icon('<circle cx="256" cy="256" r="48"/><path d="M416 256a160 160 0 01-4 32l48 36-48 80-52-20a160 160 0 01-56 32l-8 56h-96l-8-56a160 160 0 01-56-32l-52 20-48-80 48-36a160 160 0 01-4-32 160 160 0 014-32l-48-36 48-80 52 20a160 160 0 0156-32l8-56h96l8 56a160 160 0 0156 32l52-20 48 80-48 36a160 160 0 014 32z"/>', GOLD);
const COPY = icon('<rect x="168" y="168" width="224" height="224" rx="32"/><path d="M328 168V120a24 24 0 00-24-24H120a24 24 0 00-24 24v184a24 24 0 0024 24h48"/>', '#a1a1aa');
const QR = icon('<rect x="80" y="80" width="128" height="128" rx="16"/><rect x="304" y="80" width="128" height="128" rx="16"/><rect x="80" y="304" width="128" height="128" rx="16"/><path d="M304 304h48v48M400 352v80h-48M352 432h80"/>', '#a1a1aa');

const NAV = {
  wallet: icon('<path d="M80 176v224a32 32 0 0032 32h288a32 32 0 0032-32V176"/><path d="M80 176l48-80h256l48 80"/><path d="M320 288h64"/>', 'current'),
  trade: icon('<polyline points="352 144 464 144 464 256"/><path d="M48 368L169 247a32 32 0 0145 0l51 51a32 32 0 0045 0L448 160"/>', 'current'),
  activity: icon('<circle cx="256" cy="256" r="160"/><polyline points="256 160 256 256 320 304"/>', 'current'),
  settings: icon('<circle cx="256" cy="256" r="48"/><path d="M416 256a160 160 0 01-4 32l48 36-48 80-52-20a160 160 0 01-56 32l-8 56h-96l-8-56a160 160 0 01-56-32l-52 20-48-80 48-36a160 160 0 01-4-32 160 160 0 014-32l-48-36 48-80 52 20a160 160 0 0156-32l8-56h96l8 56a160 160 0 0156 32l52-20 48 80-48 36a160 160 0 014 32z"/>', 'current'),
};

export type WalletSection = 'wallet' | 'trade' | 'activity' | 'settings';

export type AccountChoice = { id: string; name: string; detail?: string };

const TABS: { id: WalletSection; label: string }[] = [
  { id: 'wallet', label: 'Wallet' },
  { id: 'trade', label: 'Trade' },
  { id: 'activity', label: 'Activity' },
  { id: 'settings', label: 'Settings' },
];

const MARK = { wart: 'WART', ethereum: 'ETH', bitcoin: 'BTC', hemi: 'HEMI', solana: 'SOL' } as const;

export default function WalletChrome({
  name,
  accounts,
  accountId,
  section,
  settingsOpen,
  chains,
  chain,
  address,
  onSection,
  onChain,
  onAccount,
  onManageAccounts,
  onLock,
  onSettings,
  onCopy,
  onReceive,
  children,
}: {
  name: string;
  accounts: AccountChoice[];
  accountId: string;
  section: WalletSection;
  settingsOpen: boolean;
  chains: WalletChain[];
  chain: WalletChain;
  address: string;
  onSection: (section: WalletSection) => void;
  onChain: (chain: WalletChain) => void;
  onAccount: (id: string) => void;
  onManageAccounts: () => void;
  onLock: () => void;
  onSettings: () => void;
  onCopy: () => void;
  onReceive: () => void;
  children: React.ReactNode;
}) {
  const [turns, setTurns] = useState(0);
  const wasSettings = useRef(settingsOpen);
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (wasSettings.current === settingsOpen) return;
    wasSettings.current = settingsOpen;
    const next = turns + 1;
    setTurns(next);
    Animated.timing(spin, { toValue: next, duration: 550, useNativeDriver: false }).start();
  }, [settingsOpen, spin, turns]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'], extrapolate: 'extend' });
  const [accountMenu, setAccountMenu] = useState(false);
  const [accountAnchor, setAccountAnchor] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const accountBox = useRef<View>(null);
  const showAccounts = () => {
    const node = accountBox.current;
    if (!node) {
      setAccountAnchor(null);
      setAccountMenu(true);
      return;
    }
    node.measureInWindow((x, y, width, height) => {
      setAccountAnchor({ x, y, width, height });
      setAccountMenu(true);
    });
  };

  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <View style={shell.header}>
        <View style={shell.row}>
          <View ref={accountBox} collapsable={false} style={{ flex: 1, minWidth: 0 }}>
            <TouchableOpacity
              style={shell.accountBtn}
              onPress={showAccounts}
              accessibilityRole="button"
              accessibilityLabel="Account"
              accessibilityState={{ expanded: accountMenu }}
            >
              <View style={shell.dot} />
              <Text style={shell.name} numberOfLines={1}>{name || 'Wallet'}</Text>
              <Text style={defiStyles.chainChevron}>▾</Text>
            </TouchableOpacity>
          </View>
          <Modal visible={accountMenu} transparent animationType="none" onRequestClose={() => setAccountMenu(false)}>
            <Pressable style={{ flex: 1 }} onPress={() => setAccountMenu(false)}>
              <Pressable
                style={[
                  defiStyles.chainMenu,
                  { minWidth: 220, maxWidth: 320 },
                  accountAnchor
                    ? { top: accountAnchor.y + accountAnchor.height + 6, left: Math.max(12, accountAnchor.x) }
                    : { top: 72, left: 16 },
                ]}
                onPress={(event) => event.stopPropagation()}
              >
                {accounts.map((account) => {
                  const on = account.id === accountId;
                  return (
                    <TouchableOpacity
                      key={account.id}
                      style={[defiStyles.chainOption, on && defiStyles.chainOptionOn]}
                      onPress={() => {
                        setAccountMenu(false);
                        if (!on) onAccount(account.id);
                      }}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                    >
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[defiStyles.chainOptionText, on && { color: '#fafafa' }]} numberOfLines={1}>{account.name}</Text>
                        {account.detail ? <Text style={shell.accountDetail} numberOfLines={1}>{account.detail}</Text> : null}
                      </View>
                    </TouchableOpacity>
                  );
                })}
                <View style={shell.menuRule} />
                <TouchableOpacity
                  style={defiStyles.chainOption}
                  onPress={() => {
                    setAccountMenu(false);
                    onManageAccounts();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Manage accounts"
                >
                  <Text style={[defiStyles.chainOptionText, { color: GOLD }]}>Manage accounts…</Text>
                </TouchableOpacity>
              </Pressable>
            </Pressable>
          </Modal>
          <TouchableOpacity style={shell.iconBtn} onPress={onLock} accessibilityRole="button" accessibilityLabel="Lock wallet">
            <SvgXml xml={LOCK} width={18} height={18} />
          </TouchableOpacity>
          <TouchableOpacity style={shell.iconBtn} onPress={onSettings} accessibilityRole="button" accessibilityLabel={settingsOpen ? 'Close settings' : 'Settings'}>
            <Animated.View style={{ transform: [{ rotate }] }}>
              <SvgXml xml={GEAR} width={18} height={18} />
            </Animated.View>
          </TouchableOpacity>
        </View>
        <View style={shell.networkRow}>
          {chains.length > 1 ? (
            <ChainPicker chains={chains} value={chain} onChange={onChain} />
          ) : (
            <View style={[defiStyles.chainTrigger, { marginBottom: 0 }]}>
              <TokenIcon symbol={MARK[chain]} size={18} />
              <Text style={defiStyles.chainTriggerText}>{chainLabel(chain)}</Text>
            </View>
          )}
          <TouchableOpacity style={shell.address} onPress={onCopy} disabled={!address} accessibilityRole="button" accessibilityLabel="Copy address">
            <Text style={shell.addressText}>{shortAddress(address)}</Text>
            <SvgXml xml={COPY} width={14} height={14} />
          </TouchableOpacity>
          <TouchableOpacity style={shell.iconBtn} onPress={onReceive} accessibilityRole="button" accessibilityLabel="Receive, show QR code">
            <SvgXml xml={QR} width={18} height={18} />
          </TouchableOpacity>
        </View>
      </View>
      <View style={{ flex: 1, minHeight: 0 }}>{children}</View>
      <View style={shell.nav} accessibilityRole="tablist">
        {TABS.map((tab) => {
          const on = section === tab.id;
          const color = on ? GOLD : MUTED;
          return (
            <TouchableOpacity
              key={tab.id}
              style={[shell.tab, on && shell.tabOn]}
              onPress={() => onSection(tab.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={tab.label}
            >
              <SvgXml xml={NAV[tab.id].split('current').join(color)} width={20} height={20} />
              <Text style={[shell.tabText, { color }]}>{tab.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const shell = {
  header: {
    backgroundColor: '#18181b',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  row: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: GOLD },
  accountBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, minWidth: 0 },
  name: { flex: 1, color: '#fafafa', fontSize: 16, fontWeight: '600' as const },
  accountDetail: { color: '#71717a', fontSize: 10, marginTop: 1 },
  menuRule: { height: 1, backgroundColor: 'rgba(255,255,255,0.08)', marginVertical: 4 },
  iconBtn: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  networkRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  address: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, marginLeft: 'auto' as const },
  addressText: { color: '#a1a1aa', fontFamily: 'monospace', fontSize: 11 },
  nav: {
    flexDirection: 'row' as const,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(24,24,27,0.96)',
    paddingTop: 8,
    paddingBottom: 8,
    marginHorizontal: -7,
    paddingHorizontal: 8,
  },
  tab: { flex: 1, alignItems: 'center' as const, gap: 4, paddingVertical: 4, borderRadius: 10 },
  tabOn: { backgroundColor: 'rgba(253,185,19,0.04)' },
  tabText: { fontSize: 11, fontWeight: '600' as const },
};
