import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';

/**
 * Surfaces the running logo sits on. Each color has a matching full-range
 * encode so the clip background is the same as the plate, not a #1C1718 square.
 * A soft edge mask is not used: the hog runs to the left and right edges.
 */
export const WART_RUN_SURFACE = {
  /** Flash intro and the confirm modal (explicitly painted this color). */
  flash: '#1c1718',
  confirm: '#1c1718',
  /** Swap / tunnel cards (`defiColors.bgCard` / swapCard). */
  card: '#18181b',
  /** DefiModalShell (`defiColors.bg`). */
  modal: '#09090b',
  /** Logged-in loading hero on TropicalBackground (`#040404`). */
  page: '#040404',
} as const;

export type WartRunSurface = (typeof WART_RUN_SURFACE)[keyof typeof WART_RUN_SURFACE];

const SOURCES = {
  '#1c1718': require('../assets/wartlogorun.mp4'),
  '#18181b': require('../assets/wartlogorun-card.mp4'),
  '#09090b': require('../assets/wartlogorun-modal.mp4'),
  '#040404': require('../assets/wartlogorun-page.mp4'),
} as const;

function normalizeSurface(color: string): keyof typeof SOURCES {
  const key = color.trim().toLowerCase() as keyof typeof SOURCES;
  return key in SOURCES ? key : '#1c1718';
}

function sourceFor(color: string) {
  return SOURCES[normalizeSurface(color)];
}

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
  surface = WART_RUN_SURFACE.flash,
  onEnd,
}: {
  /** Fixed height. Omit it and the clip keeps its own shape. */
  height?: number;
  loop?: boolean;
  /** Parent is already the plate color, as on the flash screen. */
  bare?: boolean;
  /** When flush, pull the clip up through this much card padding. */
  bleed?: number;
  /** Also pull it up through that padding. Use this when the clip is the first thing in a card. */
  flush?: boolean;
  /** Background the clip sits on. Selects the matching encode and paints the plate. */
  surface?: string;
  onEnd?: () => void;
}) {
  const plate = normalizeSurface(surface);
  const player = useVideoPlayer(sourceFor(plate), (next) => {
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
        { backgroundColor: plate },
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
        style={[styles.video, { backgroundColor: plate }]}
        nativeControls={false}
        contentFit="cover"
        surfaceType="textureView"
        useExoShutter={false}
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
    marginBottom: 6,
  },
  bare: {},
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
