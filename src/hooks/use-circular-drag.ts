"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";

export interface CircularDragHandlers {
  onPointerDown: (e: React.PointerEvent<Element>) => void;
}

export interface CircularDragOptions {
  /** 每次角度变化（弧度）触发，正值=顺时针，负值=逆时针 */
  onRotate: (deltaAngle: number, rawAngle: number) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  /** 灵敏度倍率 */
  sensitivity?: number;
}

/** 处理角度跨越 -π/π 边界，返回最短角度差 */
function angleDelta(prev: number, cur: number) {
  let d = cur - prev;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/**
 * 圆形拖拽手势 hook
 * 在圆形元素上监听指针事件，计算指针相对圆心的角度变化
 * 用于在带卷上"转圈滑动"来进退磁带
 */
export function useCircularDrag(options: CircularDragOptions): {
  bind: (el: Element | null) => void;
  handlers: CircularDragHandlers;
} {
  const optsRef = useRef(options);
  useEffect(() => {
    optsRef.current = options;
  });

  const centerRef = useRef({ x: 0, y: 0 });
  const lastAngleRef = useRef<number | null>(null);
  const draggingRef = useRef(false);
  const elRef = useRef<Element | null>(null);

  // 全局监听器常驻，用 draggingRef 控制是否响应
  useEffect(() => {
    const computeAngle = (clientX: number, clientY: number) =>
      Math.atan2(clientY - centerRef.current.y, clientX - centerRef.current.x);

    const onMove = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      e.preventDefault();
      const angle = computeAngle(e.clientX, e.clientY);
      if (lastAngleRef.current !== null) {
        const delta = angleDelta(lastAngleRef.current, angle);
        const sens = optsRef.current.sensitivity ?? 1;
        optsRef.current.onRotate(delta * sens, angle);
      }
      lastAngleRef.current = angle;
    };

    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      lastAngleRef.current = null;
      optsRef.current.onDragEnd?.();
    };

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent<Element>) => {
    const el = elRef.current;
    if (!el) return;
    e.preventDefault();
    optsRef.current.onDragStart?.();
    const rect = el.getBoundingClientRect();
    centerRef.current = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
    lastAngleRef.current = Math.atan2(
      e.clientY - centerRef.current.y,
      e.clientX - centerRef.current.x
    );
    draggingRef.current = true;
  }, []);

  const bind = useCallback((el: Element | null) => {
    elRef.current = el;
  }, []);

  return useMemo(
    () => ({ bind, handlers: { onPointerDown } }),
    [bind, onPointerDown]
  );
}
