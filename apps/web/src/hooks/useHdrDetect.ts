// melodyflix web — HDR detection (Section 4.8)
import { useEffect, useState } from 'react';

export type HdrFormat = 'hdr10' | 'hdr10+' | 'dolby_vision' | 'hlg' | null;

export interface HdrDetection {
  isHdr: boolean;
  format: HdrFormat;
  source: 'manifest' | 'media-capabilities' | 'metadata' | 'none';
}

export function useHdrDetect(opts: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  manifestUrl?: string | null;
  serverHdrFormat?: string | null;
  serverIsHdr?: boolean;
}): HdrDetection {
  const { manifestUrl, serverHdrFormat, serverIsHdr } = opts;
  const [detection, setDetection] = useState<HdrDetection>({
    isHdr: !!serverIsHdr,
    format: (serverHdrFormat as HdrFormat) ?? null,
    source: serverIsHdr ? 'metadata' : 'none',
  });

  useEffect(() => {
    if (serverIsHdr) {
      setDetection({ isHdr: true, format: (serverHdrFormat as HdrFormat) ?? null, source: 'metadata' });
      return;
    }
    if (serverIsHdr === false) {
      setDetection({ isHdr: false, format: null, source: 'metadata' });
      return;
    }
    if (!manifestUrl) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(manifestUrl, { headers: { Range: 'bytes=0-4095' } });
        if (!res.ok) return;
        const text = await res.text();
        const detected = detectFromManifest(text);
        if (!cancelled && detected.isHdr) setDetection(detected);
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [manifestUrl, serverIsHdr, serverHdrFormat]);

  return detection;
}

function detectFromManifest(text: string): HdrDetection {
  if (/VIDEO-RANGE=PQ/i.test(text)) return { isHdr: true, format: 'hdr10', source: 'manifest' };
  if (/VIDEO-RANGE=HLG/i.test(text)) return { isHdr: true, format: 'hlg', source: 'manifest' };
  if (/dvh[1e]/i.test(text) || /dolby.?vision/i.test(text)) {
    return { isHdr: true, format: 'dolby_vision', source: 'manifest' };
  }
  return { isHdr: false, format: null, source: 'none' };
}
