import React from 'react';
import { View, Text } from 'react-native';
import { defiStyles } from './defiStyles';

interface Props {
  title?: string;
  subtitle?: string;
  accessory?: React.ReactNode;
}

const DefiPageHeader: React.FC<Props> = ({
  title = 'Wallet Overview',
  subtitle = 'Your balances, assets, and open orders',
  accessory,
}) => (
  <View style={[defiStyles.pageHeader, accessory ? defiStyles.pageHeaderRow : null]}>
    <View style={{ flex: 1 }}>
      <Text style={defiStyles.pageTitle}>{title}</Text>
      <Text style={defiStyles.pageSubtitle}>{subtitle}</Text>
    </View>
    {accessory}
  </View>
);

export default DefiPageHeader;