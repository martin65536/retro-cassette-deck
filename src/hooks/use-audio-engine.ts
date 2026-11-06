"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { TapeAudioEngine } from "@/lib/audio-engine";

export interface AudioEngineState {
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  rate: number;
  isFallback: boolean;
}

export function useAudioEngine() {
  const engineRef = useRef<TapeAudioEngine | null>(null);

  // 用 ref 存回调，避免引擎重建
  const onEndedRef = useRef<() => void>(() => {});
  const onLoadedRef = useRef<(duration: number) => void>(() => {});
  const onErrorRef = useRef<(msg: string) => void>(() => {});

  useEffect(() => {
    engineRef.current = new TapeAudioEngine({
      onEnded: () => onEndedRef.current(),
      onLoaded: (d) => onLoadedRef.current(d),
      onError: (m) => onErrorRef.current(m),
    });
    return () => {
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, []);

  const load = useCallback(async (url: string) => {
    return engineRef.current?.load(url);
  }, []);

  const play = useCallback((offset?: number) => {
    engineRef.current?.play(offset);
  }, []);

  const pause = useCallback(() => {
    engineRef.current?.pause();
  }, []);

  const stop = useCallback(() => {
    engineRef.current?.stop();
  }, []);

  const seek = useCallback((time: number) => {
    engineRef.current?.seek(time);
  }, []);

  const setPlayhead = useCallback((time: number) => {
    engineRef.current?.setPlayhead(time);
  }, []);

  const setRate = useCallback((rate: number) => {
    engineRef.current?.setRate(rate);
  }, []);

  const setVolume = useCallback((v: number) => {
    engineRef.current?.setVolume(v);
  }, []);

  const tick = useCallback((dt: number) => {
    engineRef.current?.tick(dt);
  }, []);

  const resume = useCallback(() => {
    engineRef.current?.resume();
  }, []);

  const getEngine = useCallback(() => engineRef.current, []);

  return useMemo(
    () => ({
      load,
      play,
      pause,
      stop,
      seek,
      setPlayhead,
      setRate,
      setVolume,
      tick,
      resume,
      getEngine,
      onEndedRef,
      onLoadedRef,
      onErrorRef,
    }),
    [
      load,
      play,
      pause,
      stop,
      seek,
      setPlayhead,
      setRate,
      setVolume,
      tick,
      resume,
      getEngine,
    ]
  );
}
