import React from 'react';
import { View, ImageBackground, StyleSheet, Platform } from 'react-native';

const BG_BASE = '#040404';
const PATTERN = require('../assets/bg-tropical.jpg');

interface Props {
  children: React.ReactNode;
}

/**
 * Subtle tropical foliage backdrop — matches wartbunker global.css body::before.
 * Cards and modals stay opaque; only the page backdrop shows the pattern.
 * The web tile fills this view. A fixed 480px image width left the rest of the window bare.
 */
const TropicalBackground: React.FC<Props> = ({ children }) => {
  return (
    <View style={styles.root}>
      <ImageBackground
        source={PATTERN}
        style={styles.bgImage}
        imageStyle={styles.bgImageFill}
        resizeMode={Platform.OS === 'web' ? 'repeat' : 'cover'}
      />
      <View style={styles.tint} pointerEvents="none" />
      <View style={styles.content}>{children}</View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG_BASE,
  },
  bgImage: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
    opacity: 0.085,
  },
  // The asset's own 1024px size would otherwise win and stop short of a wide window.
  bgImageFill: {
    width: '100%',
    height: '100%',
  },
  tint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.38)',
  },
  content: {
    flex: 1,
  },
});

export default TropicalBackground;