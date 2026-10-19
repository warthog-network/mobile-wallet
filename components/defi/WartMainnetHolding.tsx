import React from 'react';
import { Text, View } from 'react-native';
import { defiStyles } from './defiStyles';

/** Mainnet or testnet for the network that is selected. */
export function NetworkModeBadge({ mainnet }: { mainnet: boolean }) {
  return (
    <View style={[defiStyles.modeBadge, mainnet ? defiStyles.modeBadgeMain : defiStyles.modeBadgeTest]}>
      <Text style={[defiStyles.modeBadgeText, mainnet ? defiStyles.modeBadgeTextMain : defiStyles.modeBadgeTextTest]}>
        {mainnet ? 'Mainnet' : 'Testnet'}
      </Text>
    </View>
  );
}
