"use client";

export interface CircularDragHandlers {
  onPointerDown: (e: React.PointerEvent<Element>) => void;
}

export interface CircularDragOptions {
  /** 每次角度变化（弧度）触发，正值=顺时针，负值=逆时针 */
  onRotate: (deltaAngle: number, rawAngle: number) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
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
 * 圆形拖拽手势 —— 纯函数版（无 React hook）
 * 绑定到元素后，返回 cleanup() 用于卸载时移除监听器。
 */
export function setupCircularDrag(
  getEl: () => Element | null,
  options: CircularDragOptions
): { handlers: CircularDragHandlers; cleanup: () => void } {
  // 用闭包变量代替 ref
  const center = { x: 0, y: 0 };
  let lastAngle: number | null = null;
  let dragging = false;

  // 全局监听器常驻，用 dragging 控制是否响应
  const onMove = (e: PointerEvent) => {
    if (!dragging) return;
    e.preventDefault();
    const angle = Math.atan2(e.clientY - center.y, e.clientX - center.x);
    if (lastAngle !== null) {
      const delta = angleDelta(lastAngle, angle);
      const sens = options.sensitivity ?? 1;
      options.onRotate(delta * sens, angle);
    }
    lastAngle = angle;
  };

  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    lastAngle = null;
    options.onDragEnd?.();
  };

  const onPointerDown = (e: React.PointerEvent<Element>) => {
    const el = getEl();
    if (!el) return;
    e.preventDefault();
    options.onDragStart?.();
    const rect = el.getBoundingClientRect();
    center.x = rect.left + rect.width / 2;
    center.y = rect.top + rect.height / 2;
    lastAngle = Math.atan2(e.clientY - center.y, e.clientX - center.x);
    dragging = true;
  };

  window.addEventListener("pointermove", onMove, { passive: false });
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);

  const cleanup = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
  };

  return { handlers: { onPointerDown }, cleanup };
}
