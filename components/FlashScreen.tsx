import React, { useCallback, useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import WartRun, { WART_RUN_SURFACE } from './WartRun';

/** One play of the running logo, then the wallet. Tap anywhere to skip. */
export default function FlashScreen({ onDone }: { onDone: () => void }) {
  const done = useRef(false);
  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    onDone();
  }, [onDone]);

  useEffect(() => {
    const timer = setTimeout(finish, 8000);
    return () => clearTimeout(timer);
  }, [finish]);

  return (
    <Pressable
      style={styles.fill}
      onPress={finish}
      accessibilityRole="button"
      accessibilityLabel="Skip the intro"
    >
      <View style={styles.clip}>
        <WartRun bare loop={false} surface={WART_RUN_SURFACE.flash} onEnd={finish} />
      </View>
      <Text style={styles.title}>WARTHOG WALLET</Text>
      <Text style={styles.hint}>Tap to continue</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 80,
    elevation: 80,
    backgroundColor: '#1c1718',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  clip: {
    width: '88%',
    maxWidth: 420,
  },
  title: {
    marginTop: 8,
    color: '#E79300',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  hint: {
    marginTop: 10,
    color: '#71717a',
    fontSize: 12,
  },
});
