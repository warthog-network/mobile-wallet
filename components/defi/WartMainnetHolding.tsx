import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { defiStyles } from './defiStyles';

/** Mainnet or testnet for the network that is selected. On Warthog it can switch the node family. */
export function NetworkModeBadge({ mainnet, onPress }: { mainnet: boolean; onPress?: () => void }) {
  const badge = (
    <View style={[defiStyles.modeBadge, mainnet ? defiStyles.modeBadgeMain : defiStyles.modeBadgeTest]}>
      <Text style={[defiStyles.modeBadgeText, mainnet ? defiStyles.modeBadgeTextMain : defiStyles.modeBadgeTextTest]}>
        {mainnet ? 'Mainnet' : 'Testnet'}
      </Text>
    </View>
  );
  if (!onPress) return badge;
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${mainnet ? 'Mainnet' : 'Testnet'}. Switch network`}
    >
      {badge}
    </TouchableOpacity>
  );
}
