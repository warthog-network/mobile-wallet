import React from 'react';
import { Text, View } from 'react-native';
import HemiTunnelModal from './HemiTunnelModal';
import { swapPanelStyles as styles } from './swapPanelStyles';

interface Props {
  visible: boolean;
  btcAddress: string;
  hemiAddress: string;
  ledger?: boolean;
}

/** Bitcoin has no same-chain swap. The card is the Hemi BTC tunnel. */
const BtcTunnelCard: React.FC<Props> = ({ visible, btcAddress, hemiAddress, ledger }) => {
  if (!visible) return null;
  return (
    <View style={styles.swapCard}>
      <View style={styles.cardHeader}>
        <View style={{ flex: 1, gap: 6 }}>
          <View style={styles.chipRow}>
            <View style={[styles.chip, styles.chipActive]}>
              <Text style={[styles.chipText, styles.chipTextActive]}>Tunnel</Text>
            </View>
          </View>
          <Text style={styles.cardSub}>Bitcoin ↔ hemiBTC</Text>
        </View>
      </View>
      <HemiTunnelModal
        bare
        lockAsset="btc"
        visible
        btcAddress={btcAddress}
        hemiAddress={hemiAddress}
        ledger={ledger}
        onClose={() => {}}
      />
    </View>
  );
};

export default BtcTunnelCard;
