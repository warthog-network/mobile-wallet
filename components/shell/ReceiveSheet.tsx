import React from 'react';
import { Modal, Text, TouchableOpacity, View } from 'react-native';
import AddressQr from './AddressQr';
import { defiColors, defiStyles } from '../defi/defiStyles';
import { chainLabel, type WalletChain } from '../defi/walletChains';

/** QR for the address of the network selected in the header. */
export default function ReceiveSheet({
  visible,
  chain,
  address,
  onClose,
  onCopy,
}: {
  visible: boolean;
  chain: WalletChain;
  address: string;
  onClose: () => void;
  onCopy: () => void;
}) {
  const label = chainLabel(chain);
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={defiStyles.modalOverlay}>
        <View style={[defiStyles.modalContent, { padding: 20, alignItems: 'center' }]}>
          <View style={defiStyles.modalAccent} />
          <Text style={defiStyles.modalTitle}>Receive {label}</Text>
          <Text style={{ color: defiColors.textSecondary, textAlign: 'center', marginBottom: 16 }}>
            {address
              ? `Share this ${label} address. Coins sent to another network will not arrive here.`
              : `This wallet has no ${label} address yet.`}
          </Text>
          {address ? (
            <View style={{ backgroundColor: '#fff', padding: 12, borderRadius: 12, marginBottom: 12 }}>
              <AddressQr value={address} size={200} />
            </View>
          ) : null}
          {address ? <Text style={{ color: '#fafafa', fontFamily: 'monospace', fontSize: 12, textAlign: 'center' }} selectable>{address}</Text> : null}
          {address ? (
            <TouchableOpacity style={[defiStyles.compactBtn, { marginTop: 16 }]} onPress={onCopy}>
              <Text style={defiStyles.compactBtnText}>Copy address</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity onPress={onClose}>
            <Text style={defiStyles.modalClose}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
