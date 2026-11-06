"use client";

import React from "react";

interface TapeSliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  variant?: "progress" | "volume";
  ariaLabel?: string;
}

export interface TapeSliderHandle {
  /** 直接更新 DOM 显示，不触发 React 重渲染（rAF 高频调用用） */
  setValue: (v: number) => void;
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

/**
 * 自定义复古滑块（React 类组件，无 hooks）
 * - pointer 事件实现，避免原生 input range 样式问题与 Radix Slider 的卡顿
 * - 支持拖拽、点击轨道跳转、键盘左右箭头
 * - touch-action:none 防止移动端下拉刷新
 * - 暴露 setValue 给父组件，rAF 可直接更新 DOM（避免每帧 setState）
 */
export class TapeSlider extends React.Component<
  TapeSliderProps,
  { dragging: boolean }
> implements TapeSliderHandle
{
  trackEl: HTMLDivElement | null = null;
  fillEl: HTMLDivElement | null = null;
  thumbEl: HTMLDivElement | null = null;

  // 事件处理器绑定（实例方法，稳定引用）
  private boundWindowMove: (e: PointerEvent) => void;
  private boundWindowUp: () => void;

  constructor(props: TapeSliderProps) {
    super(props);
    this.state = { dragging: false };
    this.boundWindowMove = (e: PointerEvent) => {
      e.preventDefault();
      this.setFromClientX(e.clientX);
    };
    this.boundWindowUp = () => this.setState({ dragging: false });
  }

  // imperative：rAF 高频更新 DOM，不触发 React 重渲染
  setValue(v: number) {
    const { min, max } = this.props;
    const p = max > min ? clamp(((v - min) / (max - min)) * 100, 0, 100) : 0;
    if (this.fillEl) this.fillEl.style.width = `${p}%`;
    if (this.thumbEl) this.thumbEl.style.left = `${p}%`;
  }

  private setFromClientX(clientX: number) {
    if (!this.trackEl) return;
    const { min, max, step = 0.01, onChange } = this.props;
    const rect = this.trackEl.getBoundingClientRect();
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    const raw = min + ratio * (max - min);
    const snapped = Math.round(raw / step) * step;
    onChange(clamp(snapped, min, max));
  }

  // 拖拽开始/结束时挂载/卸载全局监听器
  componentDidUpdate(_prevProps: TapeSliderProps, prevState: { dragging: boolean }) {
    if (!prevState.dragging && this.state.dragging) {
      window.addEventListener("pointermove", this.boundWindowMove, {
        passive: false,
      });
      window.addEventListener("pointerup", this.boundWindowUp);
      window.addEventListener("pointercancel", this.boundWindowUp);
    } else if (prevState.dragging && !this.state.dragging) {
      window.removeEventListener("pointermove", this.boundWindowMove);
      window.removeEventListener("pointerup", this.boundWindowUp);
      window.removeEventListener("pointercancel", this.boundWindowUp);
    }
  }

  componentWillUnmount() {
    window.removeEventListener("pointermove", this.boundWindowMove);
    window.removeEventListener("pointerup", this.boundWindowUp);
    window.removeEventListener("pointercancel", this.boundWindowUp);
  }

  render() {
    const {
      value,
      min,
      max,
      step = 0.01,
      onChange,
      disabled,
      variant = "progress",
      ariaLabel,
    } = this.props;
    const { dragging } = this.state;
    const pct = max > min ? clamp(((value - min) / (max - min)) * 100, 0, 100) : 0;
    const isProgress = variant === "progress";

    return (
      <div
        className={[
          "relative flex items-center w-full h-5 group",
          disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer",
        ].join(" ")}
        role="slider"
        aria-label={ariaLabel}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        onKeyDown={(e) => {
          if (disabled) return;
          const span = (max - min) * 0.02;
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            onChange(clamp(value - Math.max(step, span), min, max));
          } else if (e.key === "ArrowRight") {
            e.preventDefault();
            onChange(clamp(value + Math.max(step, span), min, max));
          } else if (e.key === "Home") {
            e.preventDefault();
            onChange(min);
          } else if (e.key === "End") {
            e.preventDefault();
            onChange(max);
          }
        }}
      >
        <div
          ref={(el) => {
            this.trackEl = el;
          }}
          onPointerDown={(e) => {
            if (disabled) return;
            e.preventDefault();
            this.setState({ dragging: true });
            this.setFromClientX(e.clientX);
          }}
          className={[
            "relative w-full rounded-full",
            isProgress ? "h-2" : "h-1.5",
            "bg-stone-950/60 shadow-inner border border-stone-700/40",
          ].join(" ")}
          style={{ touchAction: "none" }}
        >
          <div
            ref={(el) => {
              this.fillEl = el;
            }}
            className={[
              "absolute inset-y-0 left-0 rounded-full",
              isProgress
                ? "bg-gradient-to-r from-amber-600 to-orange-500"
                : "bg-gradient-to-r from-amber-700 to-orange-600",
            ].join(" ")}
            style={{ width: `${pct}%` }}
          />
          <div
            ref={(el) => {
              this.thumbEl = el;
            }}
            className={[
              "absolute top-1/2 -translate-y-1/2 -translate-x-1/2",
              "rounded-full border-2 border-amber-900/60",
              "shadow-md",
              isProgress
                ? "w-4 h-4 bg-gradient-to-b from-amber-100 to-amber-300"
                : "w-3.5 h-3.5 bg-gradient-to-b from-amber-100 to-amber-400",
              "transition-transform duration-75",
              dragging ? "scale-110" : "group-hover:scale-105",
              "group-focus-within:ring-2 group-focus-within:ring-orange-400/50",
            ].join(" ")}
            style={{ left: `${pct}%` }}
          />
        </div>
      </div>
    );
  }
}
