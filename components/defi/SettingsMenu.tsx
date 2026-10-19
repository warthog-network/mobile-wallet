import React, { useRef, useState } from 'react';
import { Dimensions, Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { defiColors, defiStyles } from './defiStyles';

const GEAR = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="none" stroke="${defiColors.gold}" stroke-width="32" stroke-linecap="round" stroke-linejoin="round"><path d="M262.29,192.31a64,64,0,1,0,57.4,57.4A64.13,64.13,0,0,0,262.29,192.31ZM416.39,256a154.34,154.34,0,0,1-1.53,20.79l45.21,35.46A10.81,10.81,0,0,1,462.52,326l-42.77,74a10.81,10.81,0,0,1-13.14,4.59l-44.9-18.08a16.11,16.11,0,0,0-15.17,1.75A164.48,164.48,0,0,1,325,400.8a15.94,15.94,0,0,0-8.82,12.14l-6.73,47.89A11.08,11.08,0,0,1,298.77,470H213.23a11.11,11.11,0,0,1-10.69-8.87l-6.72-47.82a16.07,16.07,0,0,0-9-12.22,155.3,155.3,0,0,1-21.46-12.57,16,16,0,0,0-15.11-1.71l-44.89,18.07a10.81,10.81,0,0,1-13.14-4.58l-42.77-74a10.8,10.8,0,0,1,2.45-13.75l38.21-30a16.05,16.05,0,0,0,6-14.08c-.36-4.17-.58-8.33-.58-12.5s.21-8.27.58-12.35a16,16,0,0,0-6.07-13.94l-38.19-30A10.81,10.81,0,0,1,49.48,186l42.77-74a10.81,10.81,0,0,1,13.14-4.59l44.9,18.08a16.11,16.11,0,0,0,15.17-1.75A164.48,164.48,0,0,1,187,111.2a15.94,15.94,0,0,0,8.82-12.14l6.73-47.89A11.08,11.08,0,0,1,213.23,42h85.54a11.11,11.11,0,0,1,10.69,8.87l6.72,47.82a16.07,16.07,0,0,0,9,12.22,155.3,155.3,0,0,1,21.46,12.57,16,16,0,0,0,15.11,1.71l44.89-18.07a10.81,10.81,0,0,1,13.14,4.58l42.77,74a10.8,10.8,0,0,1-2.45,13.75l-38.21,30a16.05,16.05,0,0,0-6.05,14.08C416.17,247.67,416.39,251.83,416.39,256Z"/></svg>`;

export interface SettingsItem {
  id: string;
  label: string;
  onPress: () => void;
}

type Anchor = { left: number; width: number; maxHeight: number; top?: number; bottom?: number };

/** Gear in the page header. Opens the old menu row as a dropdown under the icon. */
export default function SettingsMenu({
  items,
  activeId,
}: {
  items: SettingsItem[];
  activeId?: string | null;
}) {
  const box = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  const show = () => {
    const node = box.current;
    const place = (x: number, y: number, width: number, height: number) => {
      const menuWidth = 200;
      const margin = 8;
      const gap = 6;
      const screen = Dimensions.get('window');
      const below = screen.height - (y + height) - margin;
      const above = y - margin;
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
      place(24, 24, 36, 36);
      return;
    }
    node.measureInWindow((x, y, width, height) => place(x, y, width, height));
  };

  return (
    <View ref={box} collapsable={false}>
      <TouchableOpacity
        style={[defiStyles.settingsBtn, open && defiStyles.settingsBtnOn]}
        onPress={show}
        accessibilityRole="button"
        accessibilityLabel="Settings"
        accessibilityState={{ expanded: open }}
      >
        <SvgXml xml={GEAR} width={22} height={22} />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)}>
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
                : { top: 48, right: 16, width: 200, maxHeight: 320 },
            ]}
            onPress={(event) => event.stopPropagation()}
            accessibilityRole="menu"
          >
            <ScrollView style={{ maxHeight: Math.max(80, (anchor?.maxHeight ?? 320) - 12) }}>
              {items.map((item) => {
                const on = item.id === activeId;
                return (
                  <TouchableOpacity
                    key={item.id}
                    style={[defiStyles.chainOption, on && defiStyles.chainOptionOn]}
                    onPress={() => {
                      setOpen(false);
                      item.onPress();
                    }}
                    accessibilityRole="menuitem"
                    accessibilityLabel={item.label}
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[defiStyles.chainOptionText, on && defiStyles.chainOptionTextOn]}>{item.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
