import React from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { toast } from '../../utils/toast';
import { encodeLimitPrice } from '../../utils/encodeLimitPrice';
import { defiStyles } from './defiStyles';
import { theme } from '../../theme';

interface Props {
  assetName?: string;
  price: string;
  decimals: string;
  encoded: string;
  onPriceChange: (value: string) => void;
  onDecimalsChange: (value: string) => void;
  onEncodedChange: (value: string) => void;
  accent?: 'buy' | 'sell';
}

const LimitPriceEncoder: React.FC<Props> = ({
  assetName,
  price,
  decimals,
  encoded,
  onPriceChange,
  onDecimalsChange,
  onEncodedChange,
  accent = 'buy',
}) => {
  const borderColor = accent === 'buy' ? 'rgba(52, 211, 153, 0.45)' : 'rgba(251, 113, 133, 0.45)';

  const handleEncode = () => {
    if (!price.trim()) {
      toast.error('Missing price', 'Enter a human-readable limit price first');
      return;
    }
    const decimalsNum = parseInt(decimals, 10) || 8;
    try {
      let hex: string;
      try {
        hex = encodeLimitPrice(price, decimalsNum, { ceil: false });
      } catch {
        hex = encodeLimitPrice(price, decimalsNum, { ceil: true });
      }
      onEncodedChange(hex);
    } catch (e: any) {
      onEncodedChange('');
      toast.error('Encode failed', e?.message || 'Could not encode limit price');
    }
  };

  return (
    <View style={[defiStyles.encoderBox, { borderColor }]}>
      <Text style={defiStyles.encoderTitle}>Quick Limit Price Encoder</Text>
      <Text style={defiStyles.encoderHint}>
        Enter human price + asset decimals, then tap Encode to get the 6-character limit hex.
      </Text>

      <Text style={defiStyles.label}>Price (WART per {assetName || 'asset'})</Text>
      <TextInput
        style={defiStyles.input}
        value={price}
        onChangeText={onPriceChange}
        keyboardType="decimal-pad"
        placeholder="e.g. 0.0005"
        placeholderTextColor={theme.colors.textMuted}
      />

      <View style={defiStyles.encoderRow}>
        <View style={[defiStyles.encoderField, { minWidth: 100 }]}>
          <Text style={defiStyles.label}>Asset decimals</Text>
          <TextInput
            style={[defiStyles.input, { marginBottom: 0 }]}
            value={decimals}
            onChangeText={onDecimalsChange}
            keyboardType="number-pad"
            placeholder="8"
            placeholderTextColor={theme.colors.textMuted}
          />
        </View>
        <TouchableOpacity
          style={[defiStyles.compactBtn, defiStyles.compactBtnActive, { alignSelf: 'flex-end', marginBottom: 2 }]}
          onPress={handleEncode}
        >
          <Text style={[defiStyles.compactBtnText, defiStyles.compactBtnTextActive]}>Encode</Text>
        </TouchableOpacity>
      </View>

      <Text style={defiStyles.label}>Encoded limit (exactly 6 hex characters)</Text>
      <TextInput
        style={[defiStyles.input, { marginBottom: encoded ? theme.spacing.sm : 0 }]}
        value={encoded}
        onChangeText={(t) => onEncodedChange(t.toLowerCase().replace(/[^0-9a-f]/g, '').slice(0, 6))}
        autoCapitalize="none"
        maxLength={6}
        placeholder="e.g. c0e74d"
        placeholderTextColor={theme.colors.textMuted}
      />
      {encoded.length === 6 ? (
        <Text style={defiStyles.encoderResult}>Ready: {encoded}</Text>
      ) : null}
    </View>
  );
};

export default LimitPriceEncoder;