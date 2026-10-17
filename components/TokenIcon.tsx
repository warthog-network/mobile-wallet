import React from 'react';
import { Image, View } from 'react-native';
import { SvgXml } from 'react-native-svg';

/** Standard Ethereum mark, same glyph the Hemi wallet uses. */
const ETH_XML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><g fill="none"><circle cx="16" cy="16" r="16" fill="#627EEA"/><g fill="#FFF"><path fill-opacity=".602" d="M16.498 4v8.87l7.497 3.35z"/><path d="M16.498 4L9 16.22l7.498-3.35z"/><path fill-opacity=".602" d="M16.498 21.968v6.027L24 17.616z"/><path d="M16.498 27.995v-6.028L9 17.616z"/><path fill-opacity=".2" d="M16.498 20.573l7.497-4.353-7.497-3.348z"/><path fill-opacity=".602" d="M9 16.22l7.498 4.353v-7.701z"/></g></g></svg>`;

/** Tether mark for Ethereum USDT. */
const USDT_XML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="#26A17B"/><path fill="#fff" d="M17.922 17.383v-.002c-.11.008-.677.042-1.942.042-1.01 0-1.721-.03-1.971-.042v.003c-3.888-.171-6.79-.848-6.79-1.658s2.902-1.486 6.79-1.66v2.644c.254.018.982.061 1.988.061 1.207 0 1.812-.05 1.925-.06v-2.643c3.88.173 6.775.85 6.775 1.658 0 .81-2.895 1.485-6.775 1.657m0-3.59v-2.366h5.414V8.819H8.595v2.608h5.414v2.365c-4.4.202-7.709 1.074-7.709 2.118 0 1.044 3.309 1.915 7.709 2.118v7.582h3.913v-7.584c4.393-.202 7.694-1.073 7.694-2.116 0-1.043-3.301-1.914-7.694-2.117"/></svg>`;

export type TokenSymbol = 'WART' | 'ETH' | 'USDT';

/** Circular token mark for WART, ETH, and USDT. */
export default function TokenIcon({
  symbol,
  size = 28,
}: {
  symbol: TokenSymbol;
  size?: number;
}) {
  if (symbol === 'WART') {
    return (
      <Image
        source={require('../assets/icon.png')}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        accessibilityLabel="WART"
      />
    );
  }
  return (
    <View style={{ width: size, height: size }} accessibilityLabel={symbol}>
      <SvgXml xml={symbol === 'ETH' ? ETH_XML : USDT_XML} width={size} height={size} />
    </View>
  );
}
