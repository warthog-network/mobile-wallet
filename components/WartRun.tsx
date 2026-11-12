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
  /** Pull the clip sideways through a padded card so it is not an inset tile. */
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

  return (
    <View
      style={[
        bare ? styles.bare : styles.plate,
        height == null ? styles.natural : { height },
        !bare && bleed > 0 ? { marginHorizontal: -bleed } : null,
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
    width: '100%',
    backgroundColor: PLATE,
    marginBottom: 10,
  },
  bare: {
    width: '100%',
    backgroundColor: 'transparent',
  },
  natural: {
    aspectRatio: 1040 / 864,
  },
  video: {
    width: '100%',
    height: '100%',
  },
});
