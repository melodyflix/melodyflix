// melodyflix - mini player context
import { createContext, useContext, useState, type ReactNode } from 'react';
import type { Video } from '../lib/api';

export interface MiniPlayerState {
  video: Video;
  currentTime: number;
  wasPlaying: boolean;
  active: boolean;
}

interface PlayerContextValue {
  mini: MiniPlayerState | null;
  setMini: (state: MiniPlayerState | null) => void;
  clearMini: () => void;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [mini, setMini] = useState<MiniPlayerState | null>(null);

  function clearMini() {
    setMini(null);
  }

  return (
    <PlayerContext.Provider value={{ mini, setMini, clearMini }}>
      {children}
    </PlayerContext.Provider>
  );
}

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used inside PlayerProvider');
  return ctx;
}
