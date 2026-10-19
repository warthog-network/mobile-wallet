import React, { useRef, useState } from 'react';
import { Modal, Pressable, Text, TouchableOpacity, View } from 'react-native';
import TokenIcon, { type TokenSymbol } from '../TokenIcon';
import { defiStyles } from './defiStyles';
import type { WalletChain } from './walletChains';

const META: Record<WalletChain, { label: string; icon: TokenSymbol }> = {
  wart: { label: 'Warthog', icon: 'WART' },
  ethereum: { label: 'Ethereum', icon: 'ETH' },
  bitcoin: { label: 'Bitcoin', icon: 'BTC' },
  hemi: { label: 'Hemi', icon: 'HEMI' },
  solana: { label: 'Solana', icon: 'SOL' },
};

type Anchor = { x: number; y: number; width: number; height: number };

/** Network menu. The closed control shows the selected chain; the list is the others. */
export default function ChainPicker({
  chains,
  value,
  onChange,
}: {
  chains: WalletChain[];
  value: WalletChain;
  onChange: (chain: WalletChain) => void;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const box = useRef<View>(null);
  if (chains.length < 2) return null;
  const current = META[value] ?? META.wart;

  const show = () => {
    const node = box.current;
    if (!node) {
      setAnchor(null);
      setOpen(true);
      return;
    }
    node.measureInWindow((x, y, width, height) => {
      setAnchor({ x, y, width, height });
      setOpen(true);
    });
  };

  return (
    <View ref={box} collapsable={false}>
      <TouchableOpacity
        style={defiStyles.chainTrigger}
        onPress={show}
        accessibilityRole="button"
        accessibilityLabel="Network"
        accessibilityState={{ expanded: open }}
      >
        <TokenIcon symbol={current.icon} size={18} />
        <Text style={defiStyles.chainTriggerText}>{current.label}</Text>
        <Text style={defiStyles.chainChevron}>▾</Text>
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={{ flex: 1 }} onPress={() => setOpen(false)}>
          <Pressable
            style={[
              defiStyles.chainMenu,
              anchor
                ? { top: anchor.y + anchor.height + 6, left: anchor.x }
                : { top: 120, left: 24 },
            ]}
            onPress={(event) => event.stopPropagation()}
          >
            {chains.map((id) => {
              const meta = META[id];
              const on = id === value;
              return (
                <TouchableOpacity
                  key={id}
                  style={[defiStyles.chainOption, on && defiStyles.chainOptionOn]}
                  onPress={() => {
                    onChange(id);
                    setOpen(false);
                  }}
                  accessibilityRole="menuitem"
                  accessibilityState={{ selected: on }}
                >
                  <TokenIcon symbol={meta.icon} size={22} />
                  <Text style={[defiStyles.chainOptionText, on && defiStyles.chainOptionTextOn]}>
                    {meta.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
