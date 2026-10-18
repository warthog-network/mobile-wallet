import React from 'react';
import { Image, View } from 'react-native';
import { SvgXml } from 'react-native-svg';

/** Standard Ethereum mark, same glyph the Hemi wallet uses. */
const ETH_XML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><g fill="none"><circle cx="16" cy="16" r="16" fill="#627EEA"/><g fill="#FFF"><path fill-opacity=".602" d="M16.498 4v8.87l7.497 3.35z"/><path d="M16.498 4L9 16.22l7.498-3.35z"/><path fill-opacity=".602" d="M16.498 21.968v6.027L24 17.616z"/><path d="M16.498 27.995v-6.028L9 17.616z"/><path fill-opacity=".2" d="M16.498 20.573l7.497-4.353-7.497-3.348z"/><path fill-opacity=".602" d="M9 16.22l7.498 4.353v-7.701z"/></g></g></svg>`;

/** Tether mark for Ethereum USDT. */
const USDT_XML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="#26A17B"/><path fill="#fff" d="M17.922 17.383v-.002c-.11.008-.677.042-1.942.042-1.01 0-1.721-.03-1.971-.042v.003c-3.888-.171-6.79-.848-6.79-1.658s2.902-1.486 6.79-1.66v2.644c.254.018.982.061 1.988.061 1.207 0 1.812-.05 1.925-.06v-2.643c3.88.173 6.775.85 6.775 1.658 0 .81-2.895 1.485-6.775 1.657m0-3.59v-2.366h5.414V8.819H8.595v2.608h5.414v2.365c-4.4.202-7.709 1.074-7.709 2.118 0 1.044 3.309 1.915 7.709 2.118v7.582h3.913v-7.584c4.393-.202 7.694-1.073 7.694-2.116 0-1.043-3.301-1.914-7.694-2.117"/></svg>`;

/** Bitcoin mark, same glyph the Hemi wallet uses. */
const BTC_XML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><g fill="none"><circle cx="16" cy="16" r="16" fill="#F7931A"/><path fill="#FFF" d="M23.189 14.02c.314-2.096-1.283-3.223-3.465-3.975l.708-2.84-1.728-.43-.69 2.765c-.454-.114-.92-.22-1.385-.326l.695-2.783L15.596 6l-.708 2.839c-.376-.086-.746-.17-1.104-.26l.002-.009-2.384-.595-.46 1.846s1.283.294 1.256.312c.7.175.826.638.805 1.006l-.806 3.235c.048.012.11.03.18.057l-.183-.045-1.13 4.532c-.086.212-.303.531-.793.41.018.025-1.256-.313-1.256-.313l-.858 1.978 2.25.561c.418.105.828.215 1.231.318l-.715 2.872 1.727.43.708-2.84c.472.127.93.245 1.378.357l-.706 2.828 1.728.43.715-2.866c2.948.558 5.164.333 6.097-2.333.752-2.146-.037-3.385-1.588-4.192 1.13-.26 1.98-1.003 2.207-2.538zm-3.95 5.538c-.533 2.147-4.148.986-5.32.695l.95-3.805c1.172.293 4.929.872 4.37 3.11zm.535-5.569c-.487 1.953-3.495.96-4.47.717l.86-3.45c.975.243 4.118.696 3.61 2.733z"/></g></svg>`;

/** Hemi mark from the Hemi wallet, drawn in a circle. */
const HEMI_XML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><rect fill="#FF4600" height="20" rx="10" width="20"/><path fill="#fff" d="M11.2016 3.7519C11.1372 3.74034 11.0767 3.78272 11.0653 3.84823L10.2895 8.3296H9.71049L8.93468 3.84823C8.92333 3.78272 8.86277 3.74034 8.79844 3.7519C6.04337 4.29521 3.93165 6.68425 3.75757 9.60504C3.75757 9.60889 3.75 9.7322 3.75 9.79385C3.75 9.80156 3.75 9.80926 3.75 9.81312C3.75 9.83624 3.75 9.85935 3.75 9.88247C3.75 9.89018 3.75 9.89789 3.75 9.90945C3.75 9.94027 3.75 9.96725 3.75 9.99807C3.75 13.0961 5.92227 15.674 8.80222 16.2442C8.86656 16.2558 8.92711 16.2134 8.93846 16.1479L9.71427 11.6665H10.2933L11.0653 16.1518C11.0767 16.2173 11.1372 16.2597 11.2016 16.2481C13.9566 15.7009 16.0646 13.3119 16.2424 10.3911C16.2424 10.3873 16.25 10.2639 16.25 10.2023C16.25 10.1946 16.25 10.1869 16.25 10.183C16.25 10.1599 16.25 10.1368 16.25 10.1137C16.25 10.106 16.25 10.0983 16.25 10.0867C16.25 10.0559 16.25 10.0289 16.25 9.99807C16.2538 6.90003 14.0815 4.32218 11.2016 3.7519Z"/></svg>`;

/** Solana mark: three bars on a black circle. */
const SOL_XML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs><linearGradient id="solanaMark" x1="4" y1="28" x2="28" y2="4" gradientUnits="userSpaceOnUse"><stop stop-color="#9945FF"/><stop offset="1" stop-color="#14F195"/></linearGradient></defs><circle cx="16" cy="16" r="16" fill="#141414"/><g fill="url(#solanaMark)"><path d="M9.1 20.7c.2-.2.4-.3.7-.3h13.4c.4 0 .6.5.3.8l-2.5 2.5c-.2.2-.4.3-.7.3H7.2c-.4 0-.6-.5-.3-.8l2.2-2.5z"/><path d="M9.1 8.3c.2-.2.4-.3.7-.3h13.4c.4 0 .6.5.3.8l-2.5 2.5c-.2.2-.4.3-.7.3H7.2c-.4 0-.6-.5-.3-.8l2.2-2.5z"/><path d="M22.9 14.4c-.2-.2-.4-.3-.7-.3H8.8c-.4 0-.6.5-.3.8l2.5 2.5c.2.2.4.3.7.3h13.4c.4 0 .6-.5.3-.8l-2.5-2.5z"/></g></svg>`;

const MARKS: Record<string, string> = {
  ETH: ETH_XML,
  USDT: USDT_XML,
  BTC: BTC_XML,
  HEMI: HEMI_XML,
  SOL: SOL_XML,
};

export type TokenSymbol = 'WART' | 'ETH' | 'USDT' | 'BTC' | 'HEMI' | 'SOL';

/** Circular token mark for WART, ETH, USDT, BTC, Hemi, and SOL. */
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
      <SvgXml xml={MARKS[symbol] ?? ETH_XML} width={size} height={size} />
    </View>
  );
}
