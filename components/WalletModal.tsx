import React from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView, Share } from 'react-native';
import { Card } from './Card';
import { Button } from './Button';
import { theme } from '../theme';

interface WalletModalProps {
  visible: boolean;
  onClose: () => void;
  wallet: any;
}

export const WalletModal: React.FC<WalletModalProps> = ({
  visible,
  onClose,
  wallet
}) => {
  if (!wallet) return null;

  const handleShare = async (text: string, title: string) => {
    try {
      await Share.share({
        message: text,
        title: title,
      });
    } catch (error) {
      console.error('Error sharing:', error);
    }
  };

  const shareAddress = () => {
    handleShare(wallet.address, 'Warthog Wallet Address');
  };

  const sharePrivateKey = () => {
    handleShare(wallet.privateKey, 'Warthog Private Key (Keep Secure!)');
  };

  const shareMnemonic = () => {
    handleShare(wallet.mnemonic, 'Warthog Mnemonic Phrase (Keep Secure!)');
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.overlayTouch} onPress={onClose} />
        <View style={styles.modalContainer}>
          <Card variant="glass" style={styles.modal}>
            <View style={styles.header}>
              <Text style={styles.title}>Wallet Details</Text>
              <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                <Text style={styles.closeButtonText}>X</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
              {/* Address Section */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Address</Text>
                <View style={styles.valueContainer}>
                  <Text style={styles.valueText} selectable>
                    {wallet.address}
                  </Text>
                </View>
                <Button
                  title="Share Address"
                  variant="outline"
                  size="small"
                  onPress={shareAddress}
                  style={styles.shareButton}
                />
              </View>

              {/* Private Key Section */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Private Key</Text>
                <Text style={styles.warningText}>
                  WARNING: Never share your private key with anyone!
                </Text>
                <View style={styles.valueContainer}>
                  <Text style={styles.valueText} selectable>
                    {wallet.privateKey}
                  </Text>
                </View>
                <Button
                  title="Share Private Key"
                  variant="danger"
                  size="small"
                  onPress={sharePrivateKey}
                  style={styles.shareButton}
                />
              </View>

              {/* Mnemonic Section */}
              {wallet.mnemonic && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Mnemonic Phrase</Text>
                  <Text style={styles.warningText}>
                    WARNING: Keep your mnemonic phrase safe and secure!
                  </Text>
                  <View style={styles.valueContainer}>
                    <Text style={styles.valueText} selectable>
                      {wallet.mnemonic}
                    </Text>
                  </View>
                  <Button
                    title="Share Mnemonic"
                    variant="danger"
                    size="small"
                    onPress={shareMnemonic}
                    style={styles.shareButton}
                  />
                </View>
              )}

              {/* Security Notice */}
              <View style={styles.securityNotice}>
                <Text style={styles.securityTitle}>Security Notice</Text>
                <Text style={styles.securityText}>
                  • Never share your private key or mnemonic phrase with anyone
                </Text>
                <Text style={styles.securityText}>
                  • Always verify addresses before sending transactions
                </Text>
                <Text style={styles.securityText}>
                  • Keep multiple secure backups of your wallet
                </Text>
                <Text style={styles.securityText}>
                  • Use strong, unique passwords for wallet encryption
                </Text>
              </View>
            </ScrollView>

            <View style={styles.footer}>
              <Button
                title="Close"
                variant="primary"
                onPress={onClose}
                fullWidth
              />
            </View>
          </Card>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlayTouch: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  modalContainer: {
    width: '90%',
    maxWidth: 400,
    maxHeight: '80%',
  },
  modal: {
    padding: 0,
    backgroundColor: theme.colors.surface,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: theme.spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: theme.colors.primary,
  },
  closeButton: {
    padding: theme.spacing.sm,
    borderRadius: theme.borderRadius.sm,
  },
  closeButtonText: {
    color: theme.colors.textSecondary,
    fontSize: 18,
    fontWeight: 'bold',
  },
  content: {
    maxHeight: 500,
    padding: theme.spacing.lg,
  },
  section: {
    marginBottom: theme.spacing.lg,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.textPrimary,
    marginBottom: theme.spacing.sm,
  },
  valueContainer: {
    backgroundColor: theme.colors.background,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: theme.spacing.sm,
  },
  valueText: {
    color: theme.colors.textPrimary,
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 18,
  },
  shareButton: {
    alignSelf: 'flex-start',
  },
  warningText: {
    color: theme.colors.warning,
    fontSize: 12,
    marginBottom: theme.spacing.sm,
    fontStyle: 'italic',
  },
  securityNotice: {
    backgroundColor: theme.colors.background,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.primary,
    borderStyle: 'dashed',
  },
  securityTitle: {
    color: theme.colors.primary,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: theme.spacing.sm,
  },
  securityText: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 2,
  },
  footer: {
    padding: theme.spacing.lg,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
});
