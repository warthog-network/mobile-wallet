import React, { useRef, useState } from 'react';
import { Dimensions, Modal, Pressable, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import TokenIcon, { tokenMark } from '../TokenIcon';
import { defiColors, defiStyles } from './defiStyles';
import { swapPanelStyles as styles } from './swapPanelStyles';
import { addCustomToken, removeCustomToken, type TokenNetwork, type WalletToken } from '../../utils/walletTokens';

type ExtraChoice = {
  id: string;
  symbol: string;
  name: string;
};

type Anchor = { left: number; width: number; maxHeight: number; top?: number; bottom?: number };

interface Props {
  /** Ticker drawn on the closed pill. */
  label: string;
  tokens: WalletToken[];
  selectedId?: string;
  /** Highlights an extra row, such as Jupiter ETH, instead of a listed token. */
  selectedExtraId?: string;
  onSelect: (token: WalletToken) => void;
  extra?: ExtraChoice[];
  onExtra?: (id: string) => void;
  network?: TokenNetwork;
  /** Swap lists can add a contract or mint. Bridge lists stay closed. */
  allowAdd?: boolean;
  /** Stargate stays on ETH, so the pill does not open. */
  locked?: boolean;
  /** Closed-pill mark when it differs from the ticker, such as Hemi ETH. */
  icon?: string;
}

/**
 * Asset menu anchored under the swap pill, the same pattern as the network menu
 * and the Hemi app's swap pill.
 */
const AssetMenu: React.FC<Props> = ({
  label,
  tokens,
  selectedId,
  selectedExtraId,
  onSelect,
  extra,
  onExtra,
  network,
  allowAdd = false,
  locked = false,
  icon,
}) => {
  const box = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const show = () => {
    if (locked) return;
    const node = box.current;
    const place = (x: number, y: number, width: number, height: number) => {
      const menuWidth = 232;
      const margin = 8;
      const gap = 6;
      const screen = Dimensions.get('window');
      const below = screen.height - (y + height) - margin;
      const above = y - margin;
      // Stay on the pill. Drop down unless the pill is against the bottom edge.
      const dropDown = below >= 96 || below >= above;
      let left = x + width - menuWidth;
      if (left < margin) left = margin;
      if (left + menuWidth > screen.width - margin) left = Math.max(margin, screen.width - menuWidth - margin);
      setAnchor(dropDown
        ? { top: y + height + gap, left, width: menuWidth, maxHeight: Math.max(96, Math.min(320, below - gap)) }
        : { bottom: screen.height - y + gap, left, width: menuWidth, maxHeight: Math.max(96, Math.min(320, above - gap)) });
      setOpen(true);
    };
    if (!node) {
      place(24, 120, 80, 32);
      return;
    }
    node.measureInWindow((x, y, width, height) => place(x, y, width, height));
  };

  const close = () => {
    setOpen(false);
    setAddress('');
    setError(null);
  };

  const add = async () => {
    if (!network || busy || !address.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const token = await addCustomToken(network, address);
      setAddress('');
      onSelect(token);
      close();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not add that token.');
    } finally {
      setBusy(false);
    }
  };

  const pill = (
    <>
      <TokenIcon symbol={icon ?? tokenMark(label, network, true)} size={22} />
      <Text style={styles.tokenPillText}>{label}</Text>
      {locked ? null : <Text style={styles.tokenChevron}>▾</Text>}
    </>
  );

  return (
    <View ref={box} collapsable={false}>
      {locked ? (
        <View style={styles.tokenPill}>{pill}</View>
      ) : (
        <TouchableOpacity
          style={styles.tokenPill}
          onPress={show}
          accessibilityRole="button"
          accessibilityLabel={`Choose ${label}`}
          accessibilityState={{ expanded: open }}
        >
          {pill}
        </TouchableOpacity>
      )}
      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <Pressable style={{ flex: 1 }} onPress={close}>
          <Pressable
            style={[
              defiStyles.chainMenu,
              anchor
                ? {
                    top: anchor.top,
                    bottom: anchor.bottom,
                    left: anchor.left,
                    width: anchor.width,
                    maxHeight: anchor.maxHeight,
                  }
                : { top: 120, right: 24, width: 232, maxHeight: 320 },
            ]}
            onPress={(event) => event.stopPropagation()}
            accessibilityRole="menu"
          >
            <ScrollView
              keyboardShouldPersistTaps="handled"
              style={{ maxHeight: Math.max(80, (anchor?.maxHeight ?? 320) - 12) }}
            >
              {tokens.map((token) => {
                const on = !selectedExtraId && token.id === selectedId;
                return (
                  <View key={token.id} style={menuRow}>
                    <TouchableOpacity
                      style={[defiStyles.chainOption, on && defiStyles.chainOptionOn, { flex: 1 }]}
                      onPress={() => { onSelect(token); close(); }}
                      accessibilityRole="menuitem"
                      accessibilityState={{ selected: on }}
                    >
                      <TokenIcon symbol={tokenMark(token.symbol, network, token.native)} size={22} />
                      <View style={{ flex: 1 }}>
                        <Text style={[defiStyles.chainOptionText, on && defiStyles.chainOptionTextOn]}>{token.symbol}</Text>
                        {token.name !== token.symbol ? (
                          <Text style={menuHint} numberOfLines={1}>{token.name}</Text>
                        ) : null}
                      </View>
                    </TouchableOpacity>
                    {token.custom && network ? (
                      <TouchableOpacity
                        onPress={() => { void removeCustomToken(network, token.address); }}
                        accessibilityLabel={`Remove ${token.symbol}`}
                      >
                        <Text style={styles.hint}>Remove</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                );
              })}
              {extra?.map((choice) => {
                const on = choice.id === selectedExtraId;
                return (
                  <TouchableOpacity
                    key={choice.id}
                    style={[defiStyles.chainOption, on && defiStyles.chainOptionOn]}
                    onPress={() => { onExtra?.(choice.id); close(); }}
                    accessibilityRole="menuitem"
                    accessibilityState={{ selected: on }}
                  >
                    <TokenIcon symbol={choice.symbol} size={22} />
                    <View style={{ flex: 1 }}>
                      <Text style={[defiStyles.chainOptionText, on && defiStyles.chainOptionTextOn]}>{choice.symbol}</Text>
                      <Text style={menuHint} numberOfLines={1}>{choice.name}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
              {allowAdd && network ? (
                <View style={{ paddingHorizontal: 8, paddingTop: 8, gap: 6 }}>
                  <Text style={styles.mutedLabel}>Add a token</Text>
                  <TextInput
                    style={menuInput}
                    value={address}
                    onChangeText={(text) => { setAddress(text.trim()); setError(null); }}
                    autoCapitalize="none"
                    autoCorrect={false}
                    placeholder={network === 'solana' ? 'Mint address' : 'Contract address 0x…'}
                    placeholderTextColor="#3f3f46"
                  />
                  {error ? <Text style={styles.warn}>{error}</Text> : null}
                  <TouchableOpacity
                    style={[styles.chip, (!address.trim() || busy) && { opacity: 0.45 }]}
                    disabled={!address.trim() || busy}
                    onPress={() => { void add(); }}
                  >
                    <Text style={styles.chipText}>{busy ? 'Checking…' : 'Add token'}</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
};

const menuRow = { flexDirection: 'row' as const, alignItems: 'center' as const };
const menuHint = { color: defiColors.textMuted, fontSize: 11, marginTop: 1 };
const menuInput = {
  color: '#fff',
  fontSize: 13,
  borderWidth: 1,
  borderColor: 'rgba(113, 113, 122, 0.9)',
  borderRadius: 10,
  paddingHorizontal: 8,
  paddingVertical: 6,
};

export default AssetMenu;
