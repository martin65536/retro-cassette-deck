"use client";

import {
  RotateCcw,
  Play,
  Pause,
  Square,
  RotateCw,
  ChevronUp,
  type LucideIcon,
} from "lucide-react";
import type { Winding } from "./cassette-tape";

interface TransportControlsProps {
  playing: boolean;
  winding: Winding;
  hasTape: boolean;
  onPlayPause: () => void;
  onStop: () => void;
  onFastForwardStart: () => void;
  onFastForwardEnd: () => void;
  onRewindStart: () => void;
  onRewindEnd: () => void;
  onEject: () => void;
}

interface MechButtonProps {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  disabled?: boolean;
  accent?: boolean;
  onPointerDown?: () => void;
  onPointerUp?: () => void;
  onPointerLeave?: () => void;
  onClick?: () => void;
}

function MechButton({
  icon: Icon,
  label,
  active,
  disabled,
  accent,
  onPointerDown,
  onPointerUp,
  onPointerLeave,
  onClick,
}: MechButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      onPointerDown={(e) => {
        e.preventDefault();
        onPointerDown?.();
      }}
      onPointerUp={(e) => {
        e.preventDefault();
        onPointerUp?.();
      }}
      onPointerLeave={onPointerLeave}
      className={[
        "relative flex flex-col items-center justify-center gap-1",
        "w-16 h-16 sm:w-[72px] sm:h-[72px]",
        "rounded-lg select-none touch-none",
        "transition-all duration-100",
        "border-b-[4px] active:border-b-0 active:translate-y-[4px]",
        active
          ? "border-b-0 translate-y-[4px] bg-amber-700 border-amber-900"
          : "bg-gradient-to-b from-stone-600 to-stone-800 border-stone-950",
        disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer",
        "shadow-lg shadow-stone-950/40",
      ].join(" ")}
      style={{
        boxShadow: active
          ? "inset 0 2px 6px rgba(0,0,0,0.5)"
          : "0 4px 8px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.12)",
      }}
    >
      <Icon
        className={[
          "w-5 h-5 sm:w-6 sm:h-6",
          accent ? "text-orange-300" : "text-stone-100",
          active ? "text-orange-200" : "",
        ].join(" ")}
        strokeWidth={2.2}
      />
      <span
        className={[
          "text-[9px] font-bold tracking-wider",
          "font-mono",
          accent ? "text-orange-300" : "text-stone-300",
          active ? "text-orange-200" : "",
        ].join(" ")}
      >
        {label}
      </span>
    </button>
  );
}

export function TransportControls({
  playing,
  winding,
  hasTape,
  onPlayPause,
  onStop,
  onFastForwardStart,
  onFastForwardEnd,
  onRewindStart,
  onRewindEnd,
  onEject,
}: TransportControlsProps) {
  const isFF = winding === "forward";
  const isRW = winding === "rewind";

  return (
    <div className="flex items-center justify-center gap-2 sm:gap-3 flex-wrap">
      <MechButton
        icon={RotateCcw}
        label="REW"
        active={isRW}
        disabled={!hasTape}
        accent={isRW}
        onPointerDown={onRewindStart}
        onPointerUp={onRewindEnd}
        onPointerLeave={onRewindEnd}
      />
      <MechButton
        icon={playing ? Pause : Play}
        label={playing ? "PAUSE" : "PLAY"}
        active={playing}
        disabled={!hasTape}
        accent
        onClick={onPlayPause}
      />
      <MechButton
        icon={Square}
        label="STOP"
        disabled={!hasTape}
        onClick={onStop}
      />
      <MechButton
        icon={RotateCw}
        label="FF"
        active={isFF}
        disabled={!hasTape}
        accent={isFF}
        onPointerDown={onFastForwardStart}
        onPointerUp={onFastForwardEnd}
        onPointerLeave={onFastForwardEnd}
      />
      <MechButton
        icon={ChevronUp}
        label="EJECT"
        disabled={!hasTape}
        onClick={onEject}
      />
    </div>
  );
}
