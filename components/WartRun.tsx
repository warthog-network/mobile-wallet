import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';

const SOURCE = require('../assets/wartlogorun.mp4');

/**
 * Running wart logo. Mount only while something is on screen:
 * each instance owns a player. The plate color matches the clip,
 * so there is no frame around it.
 */
const PLATE = '#1c1718';
/** Video aspect (1040x864). Keep the clip crisp and unstretched. */
export const WART_RUN_ASPECT = 1040 / 864;
/** Compact height for pending-bridge and in-card clips: 88 is 56% of the previous 156. */
export const WART_RUN_COMPACT = 88;

export default function WartRun({
  height,
  loop = true,
  bare = false,
  bleed = 0,
  flush = false,
  onEnd,
}: {
  /** Fixed height. Omit it and the clip keeps its own shape. */
  height?: number;
  loop?: boolean;
  /** Parent is already the plate color, as on the flash screen. */
  bare?: boolean;
  /** When flush, pull the clip up through this much card padding. */
  bleed?: number;
  /** Also pull it up through that padding. Use this when the clip is the first thing in the card. */
  flush?: boolean;
  onEnd?: () => void;
}) {
  const player = useVideoPlayer(SOURCE, (next) => {
    next.loop = loop;
    next.muted = true;
    next.volume = 0;
    next.audioMixingMode = 'mixWithOthers';
    next.keepScreenOnWhilePlaying = false;
    next.play();
  });

  useEffect(() => {
    player.loop = loop;
    player.muted = true;
    player.volume = 0;
    try {
      player.audioMixingMode = 'mixWithOthers';
      player.keepScreenOnWhilePlaying = false;
    } catch {
      // Web ignores the native audio-session fields.
    }
    if (!player.playing) player.play();
  }, [player, loop]);

  useEffect(() => {
    const ended = player.addListener('playToEnd', () => onEnd?.());
    const status = player.addListener('statusChange', ({ status }) => {
      if (status === 'error') onEnd?.();
    });
    return () => {
      ended.remove();
      status.remove();
    };
  }, [player, onEnd]);

  const sized = height != null;

  return (
    <View
      style={[
        bare ? styles.bare : styles.plate,
        sized ? styles.center : null,
        sized ? { height, aspectRatio: WART_RUN_ASPECT, alignSelf: 'center' } : styles.natural,
        // Horizontal bleed used to pull a full-width banner through card padding.
        // The compact clip is now intrinsically sized and centered, so only flush
        // (marginTop) still applies when the clip is the first thing in a card.
        !bare && flush && bleed > 0 ? { marginTop: -bleed } : null,
      ]}
      accessibilityRole="image"
      accessibilityLabel="Warthog running"
    >
      <VideoView
        player={player}
        style={styles.video}
        nativeControls={false}
        contentFit="contain"
        allowsFullscreen={false}
        allowsPictureInPicture={false}
        allowsVideoFrameAnalysis={false}
        playsInline
      />
    </View>
  );
}

const styles = StyleSheet.create({
  plate: {
    backgroundColor: PLATE,
    marginBottom: 6,
  },
  bare: {
    backgroundColor: 'transparent',
  },
  natural: {
    width: '100%',
    aspectRatio: WART_RUN_ASPECT,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  video: {
    width: '100%',
    height: '100%',
  },
});
