import React from 'react';
import { View } from 'react-native';
import QRCode from 'qrcode';

/** Solid black and white squares. The SVG QR left the light squares transparent on web. */
export default function AddressQr({ value, size = 200 }: { value: string; size?: number }) {
  const modules = QRCode.create(value, { errorCorrectionLevel: 'M' }).modules;
  const count = modules.size;
  const cell = Math.max(1, Math.floor(size / count));
  const dim = cell * count;
  const rows = [];
  for (let y = 0; y < count; y += 1) {
    const squares = [];
    for (let x = 0; x < count; x += 1) {
      squares.push(
        <View
          key={x}
          style={{ width: cell, height: cell, backgroundColor: modules.get(x, y) ? '#000' : '#fff' }}
        />,
      );
    }
    rows.push(
      <View key={y} style={{ flexDirection: 'row', height: cell }}>
        {squares}
      </View>,
    );
  }
  return (
    <View style={{ width: size, height: size, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: dim, height: dim, backgroundColor: '#fff' }}>{rows}</View>
    </View>
  );
}
