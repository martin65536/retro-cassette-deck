"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

interface TapeSliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  /** 轨道高度风格 */
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
 * 自定义复古滑块
 * - pointer 事件实现，避免原生 input range 样式问题与 Radix Slider 的卡顿
 * - 支持拖拽、点击轨道跳转、键盘左右箭头
 * - touch-action:none 防止移动端下拉刷新
 * - 暴露 imperative handle，rAF 可直接更新 DOM（避免每帧 setState）
 */
export const TapeSlider = forwardRef<TapeSliderHandle, TapeSliderProps>(
  function TapeSlider(
    {
      value,
      min,
      max,
      step = 0.01,
      onChange,
      disabled,
      variant = "progress",
      ariaLabel,
    },
    ref
  ) {
    const trackRef = useRef<HTMLDivElement>(null);
    const fillRef = useRef<HTMLDivElement>(null);
    const thumbRef = useRef<HTMLDivElement>(null);
    const [dragging, setDragging] = useState(false);

    const pct =
      max > min ? clamp(((value - min) / (max - min)) * 100, 0, 100) : 0;

    const applyPct = useCallback((p: number) => {
      if (fillRef.current) fillRef.current.style.width = `${p}%`;
      if (thumbRef.current) thumbRef.current.style.left = `${p}%`;
    }, []);

    // imperative：rAF 高频更新 DOM，不触发 React 重渲染
    useImperativeHandle(
      ref,
      () => ({
        setValue: (v: number) => {
          const p =
            max > min
              ? clamp(((v - min) / (max - min)) * 100, 0, 100)
              : 0;
          applyPct(p);
        },
      }),
      [min, max, applyPct]
    );

    const setFromClientX = useCallback(
      (clientX: number) => {
        const el = trackRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
        const raw = min + ratio * (max - min);
        const snapped = Math.round(raw / step) * step;
        onChange(clamp(snapped, min, max));
      },
      [min, max, step, onChange]
    );

    useEffect(() => {
      if (!dragging) return;
      const onMove = (e: PointerEvent) => {
        e.preventDefault();
        setFromClientX(e.clientX);
      };
      const onUp = () => setDragging(false);
      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
      return () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };
    }, [dragging, setFromClientX]);

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
          ref={trackRef}
          onPointerDown={(e) => {
            if (disabled) return;
            e.preventDefault();
            setDragging(true);
            setFromClientX(e.clientX);
          }}
          className={[
            "relative w-full rounded-full",
            isProgress ? "h-2" : "h-1.5",
            "bg-stone-400/40 dark:bg-stone-700/60",
            "shadow-inner",
          ].join(" ")}
          style={{ touchAction: "none" }}
        >
          <div
            ref={fillRef}
            className={[
              "absolute inset-y-0 left-0 rounded-full",
              isProgress
                ? "bg-gradient-to-r from-amber-600 to-orange-500"
                : "bg-gradient-to-r from-stone-500 to-stone-300",
            ].join(" ")}
            style={{ width: `${pct}%` }}
          />
          <div
            ref={thumbRef}
            className={[
              "absolute top-1/2 -translate-y-1/2 -translate-x-1/2",
              "rounded-full border-2 border-amber-900/60",
              "shadow-md",
              isProgress
                ? "w-4 h-4 bg-gradient-to-b from-amber-100 to-amber-300"
                : "w-3.5 h-3.5 bg-gradient-to-b from-stone-100 to-stone-300",
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
);
