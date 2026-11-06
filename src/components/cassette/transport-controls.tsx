"use client";

import React from "react";
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

/** 机械按钮（React 类组件） */
class MechButton extends React.Component<MechButtonProps> {
  render() {
    const {
      icon: Icon,
      label,
      active,
      disabled,
      accent,
      onPointerDown,
      onPointerUp,
      onPointerLeave,
      onClick,
    } = this.props;
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
          "select-none touch-none",
          "transition-all duration-100",
          "border border-black",
          active
            ? "bg-black text-white"
            : "bg-white text-black hover:bg-gray-100",
          disabled ? "opacity-30 cursor-not-allowed" : "cursor-pointer",
        ].join(" ")}
        style={{
          boxShadow: active ? "inset 0 0 0 1px #000" : "none",
        }}
      >
        <Icon
          className={[
            "w-5 h-5 sm:w-6 sm:h-6",
            active ? "text-white" : "text-black",
          ].join(" ")}
          strokeWidth={2}
        />
        <span
          className={[
            "text-[9px] font-bold tracking-wider",
            "font-mono",
            active ? "text-white" : "text-black",
          ].join(" ")}
        >
          {label}
        </span>
      </button>
    );
  }
}

/** 传输控制面板（React 类组件） */
export class TransportControls extends React.Component<TransportControlsProps> {
  render() {
    const {
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
    } = this.props;
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
}
