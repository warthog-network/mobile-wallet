import React from 'react';
import { Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { defiColors, defiStyles } from './defiStyles';

const GOLD = defiColors.gold;

/** Ionicons used by the browser wallet home: send, trending-up, water, diamond. */
const ICONS = {
  send: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="${GOLD}"><path d="M476.59,227.05l-.16-.07L49.35,49.84A23.56,23.56,0,0,0,27.14,52,24.65,24.65,0,0,0,16,72.59V185.88a24,24,0,0,0,19.52,23.57l232.93,43.07a4,4,0,0,1,0,7.86L35.53,303.45A24,24,0,0,0,16,327V440.31A23.57,23.57,0,0,0,26.59,460a23.94,23.94,0,0,0,13.22,4,24.55,24.55,0,0,0,9.52-1.93L476.4,285.94l.19-.09a32,32,0,0,0,0-58.8Z"/></svg>`,
  swap: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="none" stroke="${GOLD}" stroke-width="32" stroke-linecap="round" stroke-linejoin="round"><polyline points="352 144 464 144 464 256"/><path d="M48,368,169.37,246.63a32,32,0,0,1,45.26,0l50.74,50.74a32,32,0,0,0,45.26,0L448,160"/></svg>`,
  liquidity: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="${GOLD}"><path d="M265.12,60.12a12,12,0,0,0-18.23,0C215.23,97.15,112,225.17,112,320c0,88.37,55.64,144,144,144s144-55.63,144-144C400,225.17,296.77,97.15,265.12,60.12ZM272,412a12,12,0,0,1-11.34-16,11.89,11.89,0,0,1,11.41-8A60.06,60.06,0,0,0,332,328.07a11.89,11.89,0,0,1,8-11.41A12,12,0,0,1,356,328,84.09,84.09,0,0,1,272,412Z"/></svg>`,
  mint: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="${GOLD}"><path d="M121.72,32A4,4,0,0,0,118,37.56l2.3,5.43L161,137.89a4,4,0,0,0,6.88.82L243,38.4a4,4,0,0,0-3.2-6.4Z"/><path d="M419.93,58.06l-41.28,96.37a4,4,0,0,0,3.68,5.57h101a4,4,0,0,0,3.4-6.11L427,57.53A4,4,0,0,0,419.93,58.06Z"/><path d="M85,57.57,25.29,153.89a4,4,0,0,0,3.4,6.11h101a4,4,0,0,0,3.67-5.58L92,58.1A4,4,0,0,0,85,57.57Z"/><path d="M393.27,32H267.82a1.94,1.94,0,0,0-1.56,3.11l79.92,106.46a1.94,1.94,0,0,0,3.34-.4L391.6,43,395,34.66A1.92,1.92,0,0,0,393.3,32Z"/><path d="M239,448,149.57,194.51A3.78,3.78,0,0,0,146,192H25.7a3.72,3.72,0,0,0-2.95,6l216,279.81a5.06,5.06,0,0,0,6.39,1.37h0a5,5,0,0,0,2.39-6.08Z"/><path d="M486.3,192H366a3.75,3.75,0,0,0-3.54,2.51L264.26,472.67a5.21,5.21,0,0,0,2.42,6.31h0a5.22,5.22,0,0,0,6.61-1.39L489.25,198h0A3.72,3.72,0,0,0,486.3,192Z"/><path d="M259.2,78.93l56,74.67A4,4,0,0,1,312,160H200a4,4,0,0,1-3.2-6.4l56-74.67A4,4,0,0,1,259.2,78.93Zm-7,310.31L184.5,197.33a4,4,0,0,1,3.77-5.33H323.73a4,4,0,0,1,3.77,5.33L259.77,389.24A4,4,0,0,1,252.23,389.24Z"/></svg>`,
} as const;

const ACTIONS = [
  { id: 'send', label: 'Send', icon: ICONS.send },
  { id: 'swap', label: 'Swap', icon: ICONS.swap },
  { id: 'liquidity', label: 'Liquidity', icon: ICONS.liquidity },
  { id: 'mint', label: 'Mint', icon: ICONS.mint },
] as const;

export type WartHomeAction = (typeof ACTIONS)[number]['id'];

/**
 * Home squares from the browser wallet.
 * Warthog shows Send, Swap, Liquidity, and Mint.
 * Other chains stay collapsed to Send and Swap until one is opened.
 */
export default function WartHomeActions({
  onPress,
  actions = ['send', 'swap', 'liquidity', 'mint'],
}: {
  onPress: (action: WartHomeAction) => void;
  actions?: readonly WartHomeAction[];
}) {
  const { width } = useWindowDimensions();
  const shown = ACTIONS.filter((action) => actions.includes(action.id));
  // App scroll padding is 7px on each side. Cap the tiles so a wide browser
  // keeps equal squares, centered, instead of stretching them.
  const gaps = Math.max(shown.length - 1, 1);
  const size = Math.min(96, Math.max(68, Math.floor((width - 14 - 12 * gaps) / Math.max(shown.length, 1))));
  return (
    <View style={defiStyles.wartSquares}>
      {shown.map((action) => (
        <TouchableOpacity
          key={action.id}
          style={[defiStyles.wartSquare, { width: size, height: size }]}
          onPress={() => onPress(action.id)}
          accessibilityRole="button"
          accessibilityLabel={action.label}
        >
          <SvgXml xml={action.icon} width={24} height={24} />
          <Text style={defiStyles.wartSquareText} numberOfLines={1}>{action.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}
