/**
 * useAudioEngine — Web Audio API graph for the video element.
 *
 * Graph (in order):
 *   source (MediaElementSource)
 *     -> highpass (noise reduction / rumble cut)
 *     -> peaking x3 (3-band EQ: bass / mid / treble)
 *     -> dynamicsCompressor (normalization)
 *     -> gain (master volume / enhancement)
 *     -> splitter / panner (stereo widening — Batch B)
 *     -> destination
 *
 * All filters are optional; when feature is off, nodes are bypassed (gain=0 effect).
 */
import { useEffect, useRef } from 'react';

export interface AudioEngineSettings {
  // 45.1 — audio only mode (client-side: just UI flag, no audio graph change)
  audioOnlyMode?: boolean;

  // 45.3 — Audio enhancement (presence/clearity)
  enhancement?: number;       // 0..1, default 0
  bass?: number;              // -12..+12 dB, default 0
  mid?: number;               // -12..+12 dB, default 0
  treble?: number;            // -12..+12 dB, default 0

  // 45.4 — Noise reduction
  noiseReduction?: number;    // 0..1, default 0 (highpass cutoff 20-300 Hz)

  // 45.7 — Normalization (dynamics compressor)
  normalization?: boolean;

  // Master
  masterGain?: number;        // 0..2, default 1
}

export interface AudioEngineHandle {
  audioCtx: AudioContext | null;
  nodes: {
    source?: MediaElementAudioSourceNode;
    highpass?: BiquadFilterNode;
    bass?: BiquadFilterNode;
    mid?: BiquadFilterNode;
    treble?: BiquadFilterNode;
    compressor?: DynamicsCompressorNode;
    master?: GainNode;
  };
}

export function useAudioEngine(
  videoEl: HTMLVideoElement | null,
  settings: AudioEngineSettings,
) {
  const ctxRef = useRef<AudioContext | null>(null);
  const graphRef = useRef<AudioEngineHandle['nodes']>({});
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);

  // Build graph once
  useEffect(() => {
    if (!videoEl) return;

    // Some browsers require user gesture; defer creation until play.
    function build() {
      if (ctxRef.current) return;
      const Ctx = (window.AudioContext || (window as any).webkitAudioContext);
      if (!Ctx) return;
      const ctx: AudioContext = new Ctx();
      ctxRef.current = ctx;

      try {
        const source = ctx.createMediaElementSource(videoEl);
        sourceRef.current = source;

        const highpass = ctx.createBiquadFilter();
        highpass.type = 'highpass';
        highpass.frequency.value = 20;
        highpass.Q.value = 0.7;

        const bass = ctx.createBiquadFilter();
        bass.type = 'peaking';
        bass.frequency.value = 120;
        bass.Q.value = 0.9;
        bass.gain.value = 0;

        const mid = ctx.createBiquadFilter();
        mid.type = 'peaking';
        mid.frequency.value = 1000;
        mid.Q.value = 0.9;
        mid.gain.value = 0;

        const treble = ctx.createBiquadFilter();
        treble.type = 'peaking';
        treble.frequency.value = 6000;
        treble.Q.value = 0.9;
        treble.gain.value = 0;

        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.value = -24;
        compressor.knee.value = 30;
        compressor.ratio.value = 4;
        compressor.attack.value = 0.01;
        compressor.release.value = 0.25;

        const master = ctx.createGain();
        master.gain.value = 1;

        // Wire: source -> highpass -> bass -> mid -> treble -> compressor -> master -> destination
        source.connect(highpass);
        highpass.connect(bass);
        bass.connect(mid);
        mid.connect(treble);
        treble.connect(compressor);
        compressor.connect(master);
        master.connect(ctx.destination);

        graphRef.current = { source, highpass, bass, mid, treble, compressor, master };
      } catch {
        // Already connected? (React strict mode / hot reload)
      }
    }

    // Build lazily on first play
    const onPlay = () => {
      build();
      if (ctxRef.current?.state === 'suspended') ctxRef.current.resume().catch(() => {});
    };
    videoEl.addEventListener('play', onPlay);
    // Also try immediately if already playing
    if (!videoEl.paused) onPlay();

    return () => {
      videoEl.removeEventListener('play', onPlay);
    };
  }, [videoEl]);

  // Apply settings
  useEffect(() => {
    const g = graphRef.current;
    if (!g) return;
    const now = ctxRef.current?.currentTime ?? 0;
    const set = (param: AudioParam | undefined, v: number) => {
      if (!param) return;
      param.setTargetAtTime(v, now, 0.05);
    };

    // 45.4 — Noise reduction: raise highpass cutoff up to 300Hz
    if (g.highpass) {
      const nr = Math.max(0, Math.min(1, settings.noiseReduction ?? 0));
      set(g.highpass.frequency, 20 + nr * 280);
    }

    // 45.3 — EQ bands
    if (g.bass) set(g.bass.gain, settings.bass ?? 0);
    if (g.mid) set(g.mid.gain, settings.mid ?? 0);
    if (g.treble) set(g.treble.gain, settings.treble ?? 0);

    // Enhancement = slight high-shelf + mid clarity bump
    if (settings.enhancement && settings.enhancement > 0) {
      const e = settings.enhancement; // 0..1
      // bump treble by up to +4 dB, mid by +2 dB
      if (g.treble) set(g.treble.gain, (settings.treble ?? 0) + e * 4);
      if (g.mid) set(g.mid.gain, (settings.mid ?? 0) + e * 2);
    }

    // 45.7 — Normalization
    if (g.compressor) {
      if (settings.normalization) {
        set(g.compressor.threshold, -24);
        set(g.compressor.ratio, 6);
      } else {
        set(g.compressor.threshold, 0);
        set(g.compressor.ratio, 1);
      }
    }

    // Master gain
    if (g.master) {
      set(g.master.gain, Math.max(0, Math.min(2, settings.masterGain ?? 1)));
    }
  }, [
    settings.enhancement, settings.bass, settings.mid, settings.treble,
    settings.noiseReduction, settings.normalization, settings.masterGain,
  ]);

  return {
    audioCtx: ctxRef.current,
    nodes: graphRef.current,
  };
}
