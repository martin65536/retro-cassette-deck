"use client";

import { useRef, useState, useMemo, useCallback, useEffect, Component, Suspense, type JSX, type ReactNode } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import {
  OrbitControls,
  ContactShadows,
  RoundedBox,
  Text,
  PerspectiveCamera,
} from "@react-three/drei";
import * as THREE from "three";
import { clamp, lerp } from "@/lib/utils";
import { TapeAudioEngine } from "@/lib/audio-engine";

/* ============================================================
 * 3D 复古磁带机 —— 全屏场景
 * - 双指缩放 / 单指旋转 / 两指平移（OrbitControls）
 * - 点按按钮：REW / PLAY / STOP / FF / EJECT
 * - EJECT 打开卡带盒盖 + 弹出卡带；拖动卡带装配 / 卸载
 * - 播放时带卷旋转，FF/REW 加速
 * 光影：暖色主光 + 冷色 rim + 接触阴影 + 半球光，柔和不张扬
 * （不使用远程 HDR preset，避免网络加载导致卡 loading）
 * ============================================================ */

type Direction = "forward" | "rewind" | "stop";

/* ---------- 工具：生成带卷辐条几何 ---------- */
function useSpokes(count = 6) {
  return useMemo(() => {
    const arr: { rot: number; x: number; z: number }[] = [];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      arr.push({ rot: a, x: Math.cos(a) * 0.08, z: Math.sin(a) * 0.08 });
    }
    return arr;
  }, [count]);
}

/* ============================================================
 * 卡带（可拖动）—— 装配/卸载目标
 * ============================================================ */
function Cassette({
  position,
  rotation,
  dragging,
  songName,
}: {
  position: [number, number, number];
  rotation: [number, number, number];
  dragging: boolean;
  songName: string;
}) {
  // 卡带壳：上下两片圆角板 + 中部窗孔
  const shellMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#1c1c1e",
        roughness: 0.55,
        metalness: 0.15,
      }),
    []
  );
  const labelMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#e8e0d0",
        roughness: 0.85,
        metalness: 0.02,
      }),
    []
  );
  const tapeMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#3a2a18",
        roughness: 0.9,
        metalness: 0.05,
      }),
    []
  );

  return (
    <group position={position} rotation={rotation}>
      {/* 上壳 */}
      <RoundedBox args={[1.3, 0.16, 0.85]} radius={0.025} smoothness={4} castShadow receiveShadow>
        <primitive object={shellMat} attach="material" />
      </RoundedBox>
      {/* 下壳（稍低，形成薄缝） */}
      <RoundedBox
        args={[1.3, 0.14, 0.85]}
        radius={0.025}
        smoothness={4}
        position={[0, -0.155, 0]}
        castShadow
        receiveShadow
      >
        <primitive object={shellMat} attach="material" />
      </RoundedBox>

      {/* 两个带卷窗（深色凹槽 + 内部小卷） */}
      {([-0.36, 0.36] as const).map((x, i) => (
        <group key={i} position={[x, 0.02, 0]}>
          {/* 窗孔暗底 */}
          <mesh position={[0, 0.085, 0]}>
            <cylinderGeometry args={[0.16, 0.16, 0.02, 32]} />
            <meshStandardMaterial color="#08080a" roughness={0.4} />
          </mesh>
          {/* 内部小卷 */}
          <mesh position={[0, 0.085, 0]}>
            <cylinderGeometry args={[0.1, 0.1, 0.03, 24]} />
            <primitive object={tapeMat} attach="material" />
          </mesh>
          {/* 齿孔中心 */}
          <mesh position={[0, 0.1, 0]}>
            <cylinderGeometry args={[0.035, 0.035, 0.04, 12]} />
            <meshStandardMaterial color="#666" metalness={0.8} roughness={0.3} />
          </mesh>
        </group>
      ))}

      {/* 磁带条（两卷间） */}
      <mesh position={[0, 0.02, 0.34]}>
        <boxGeometry args={[0.62, 0.005, 0.18]} />
        <primitive object={tapeMat} attach="material" />
      </mesh>

      {/* 顶部标签纸 */}
      <mesh position={[0, 0.082, -0.05]} receiveShadow>
        <boxGeometry args={[1.05, 0.005, 0.5]} />
        <primitive object={labelMat} attach="material" />
      </mesh>
      {/* 标签文字 */}
      <Text
        position={[0, 0.088, -0.18]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.07}
        color="#2a2a2a"
        anchorX="center"
        anchorY="middle"
        maxWidth={1}
        outlineWidth={0}
      >
        {songName || "NO TAPE"}
      </Text>
      <Text
        position={[0, 0.088, 0.12]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.04}
        color="#7a7a7a"
        anchorX="center"
        anchorY="middle"
      >
        TYPE II · CrO2 · 90MIN
      </Text>

      {/* 底部两个定位孔（视觉） */}
      {([-0.55, 0.55] as const).map((x, i) => (
        <mesh key={i} position={[x, 0, -0.3]}>
          <cylinderGeometry args={[0.04, 0.04, 0.34, 16]} />
          <meshStandardMaterial color="#0a0a0c" roughness={0.6} />
        </mesh>
      ))}

      {/* 拖动时的高亮边框 */}
      {dragging && (
        <mesh position={[0, 0, 0]}>
          <boxGeometry args={[1.34, 0.4, 0.89]} />
          <meshBasicMaterial
            color="#e8a050"
            transparent
            opacity={0.18}
            wireframe
          />
        </mesh>
      )}
    </group>
  );
}

/* ============================================================
 * 磁带机机身 + 按钮组
 * ============================================================ */
interface DeckProps {
  loaded: boolean;
  playing: boolean;
  direction: Direction;
  lidOpen: boolean;
  onButton: (btn: "rew" | "play" | "stop" | "ff" | "eject") => void;
  reelAngleRef: React.MutableRefObject<number>;
}

function Deck({ loaded, playing, direction, lidOpen, onButton, reelAngleRef }: DeckProps) {
  const spokes = useSpokes(6);

  // 机身材质：拉丝金属
  const bodyMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#4a4a52",
        roughness: 0.55,
        metalness: 0.45,
      }),
    []
  );
  const topMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#3a2a20",
        roughness: 0.55,
        metalness: 0.15,
      }),
    []
  );
  const accentMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#8a8a8e",
        roughness: 0.3,
        metalness: 0.9,
      }),
    []
  );
  const glassMat = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: "#0a0a0c",
        metalness: 0.1,
        roughness: 0.08,
        transmission: 0.85,
        thickness: 0.3,
        transparent: true,
        opacity: 0.55,
      }),
    []
  );

  // 带卷旋转（useFrame 读 reelAngleRef）
  const leftReel = useRef<THREE.Group>(null);
  const rightReel = useRef<THREE.Group>(null);
  useFrame(() => {
    const a = reelAngleRef.current;
    if (leftReel.current) leftReel.current.rotation.y = -a;
    if (rightReel.current) rightReel.current.rotation.y = a;
  });

  // 盖板铰链开合
  const lidRef = useRef<THREE.Group>(null);
  useFrame(() => {
    if (!lidRef.current) return;
    const target = lidOpen ? -1.05 : 0; // 弧度
    lidRef.current.rotation.x = lerp(lidRef.current.rotation.x, target, 0.12);
  });

  return (
    <group>
      {/* ===== 机身主体 ===== */}
      <RoundedBox
        args={[3.4, 0.95, 2.3]}
        radius={0.05}
        smoothness={5}
        castShadow
        receiveShadow
      >
        <primitive object={bodyMat} attach="material" />
      </RoundedBox>

      {/* 顶部胡桃木贴板 */}
      <RoundedBox
        args={[3.3, 0.04, 2.2]}
        radius={0.03}
        smoothness={4}
        position={[0, 0.48, 0]}
        receiveShadow
      >
        <primitive object={topMat} attach="material" />
      </RoundedBox>

      {/* ===== 卡带仓（凹陷的暗框 + 玻璃盖板） ===== */}
      <group position={[0, 0.25, 0]}>
        {/* 仓内暗底 */}
        <mesh position={[0, 0.08, 0]}>
          <boxGeometry args={[1.5, 0.3, 1.0]} />
          <meshStandardMaterial color="#050507" roughness={0.9} />
        </mesh>

        {/* 内部带卷座（仅装带时可见转动） */}
        <group ref={leftReel} position={[-0.4, 0.08, 0]}>
          <ReelSpokes spokes={spokes} accentMat={accentMat} />
        </group>
        <group ref={rightReel} position={[0.4, 0.08, 0]}>
          <ReelSpokes spokes={spokes} accentMat={accentMat} />
        </group>

        {/* 玻璃盖板（铰链在后侧） */}
        <group ref={lidRef} position={[0, 0.18, -0.5]}>
          {/* 铰链轴在 z=-0.5，盖板向前延伸 */}
          <mesh position={[0, 0, 0.5]} castShadow>
            <boxGeometry args={[1.5, 0.04, 1.0]} />
            <primitive object={glassMat} attach="material" />
          </mesh>
          {/* 盖板金属边框 */}
          <mesh position={[0, 0.01, 0.5]}>
            <boxGeometry args={[1.54, 0.06, 1.04]} />
            <meshStandardMaterial color="#5a5a5e" metalness={0.9} roughness={0.3} />
          </mesh>
        </group>
      </group>

      {/* ===== 前面板按钮区 ===== */}
      <group position={[0, -0.05, 1.16]}>
        {/* 按钮面板凹槽 */}
        <mesh position={[0, 0, 0]}>
          <boxGeometry args={[3.0, 0.32, 0.04]} />
          <meshStandardMaterial color="#1a1a1c" roughness={0.7} metalness={0.4} />
        </mesh>

        {/* 五个按钮 */}
        <DeckButton
          label="◀◀"
          x={-1.1}
          active={direction === "rewind"}
          activeColor="#5a8a5a"
          onPress={() => onButton("rew")}
        />
        <DeckButton
          label="▶"
          x={-0.5}
          active={playing}
          activeColor="#e8a050"
          onPress={() => onButton("play")}
        />
        <DeckButton
          label="■"
          x={0.1}
          active={false}
          activeColor="#8a3a3a"
          onPress={() => onButton("stop")}
        />
        <DeckButton
          label="▶▶"
          x={0.7}
          active={direction === "forward"}
          activeColor="#5a8a5a"
          onPress={() => onButton("ff")}
        />
        <DeckButton
          label="⏏"
          x={1.3}
          active={lidOpen}
          activeColor="#e8a050"
          onPress={() => onButton("eject")}
        />
      </group>

      {/* ===== LED 指示灯 ===== */}
      <mesh position={[-1.45, 0.35, 1.16]}>
        <sphereGeometry args={[0.035, 16, 16]} />
        <meshStandardMaterial
          color="#5aff8a"
          emissive="#3aff70"
          emissiveIntensity={loaded ? 2.5 : 0.6}
          toneMapped={false}
        />
      </mesh>
      <mesh position={[-1.3, 0.35, 1.16]}>
        <sphereGeometry args={[0.035, 16, 16]} />
        <meshStandardMaterial
          color="#ff5a5a"
          emissive="#ff3030"
          emissiveIntensity={playing ? 2.5 : 0.4}
          toneMapped={false}
        />
      </mesh>

      {/* ===== 铭牌 ===== */}
      <mesh position={[1.3, 0.15, 1.165]}>
        <boxGeometry args={[0.7, 0.22, 0.005]} />
        <primitive object={accentMat} attach="material" />
      </mesh>
      <Text
        position={[1.3, 0.15, 1.17]}
        fontSize={0.06}
        color="#1a1a1c"
        anchorX="center"
        anchorY="middle"
      >
        TC-2020
      </Text>
      <Text
        position={[1.3, 0.07, 1.17]}
        fontSize={0.035}
        color="#3a3a3a"
        anchorX="center"
        anchorY="middle"
      >
        STEREO CASSETTE
      </Text>

      {/* ===== 侧面散热槽（装饰） ===== */}
      {[-1.68, 1.68].map((x) => (
        <group key={x} position={[x, 0, 0]}>
          {Array.from({ length: 5 }).map((_, i) => (
            <mesh key={i} position={[0, -0.2 + i * 0.1, 0]}>
              <boxGeometry args={[0.01, 0.06, 1.8]} />
              <meshStandardMaterial color="#0a0a0c" roughness={0.8} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

/* 带卷辐条组 */
function ReelSpokes({
  spokes,
  accentMat,
}: {
  spokes: { rot: number; x: number; z: number }[];
  accentMat: THREE.Material;
}) {
  return (
    <group>
      <mesh>
        <cylinderGeometry args={[0.22, 0.22, 0.06, 32]} />
        <meshStandardMaterial color="#1a1a1c" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.04, 0]}>
        <cylinderGeometry args={[0.06, 0.06, 0.1, 16]} />
        <primitive object={accentMat} attach="material" />
      </mesh>
      {spokes.map((s, i) => (
        <mesh
          key={i}
          position={[s.x, 0.02, s.z]}
          rotation={[0, s.rot, 0]}
          castShadow
        >
          <boxGeometry args={[0.14, 0.03, 0.02]} />
          <meshStandardMaterial color="#3a3a3e" metalness={0.5} roughness={0.5} />
        </mesh>
      ))}
    </group>
  );
}

/* 按钮 */
function DeckButton({
  label,
  x,
  active,
  activeColor,
  onPress,
}: {
  label: string;
  x: number;
  active: boolean;
  activeColor: string;
  onPress: () => void;
}) {
  const ref = useRef<THREE.Group>(null);
  const [pressed, setPressed] = useState(false);

  useFrame(() => {
    if (!ref.current) return;
    const targetY = pressed ? -0.04 : 0;
    ref.current.position.y = lerp(ref.current.position.y, targetY, 0.3);
  });

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setPressed(true);
  };
  const handlePointerUp = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setPressed(false);
    onPress();
  };

  return (
    <group ref={ref} position={[x, 0, 0.04]}>
      <mesh
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerOver={(e) => {
          e.stopPropagation();
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          document.body.style.cursor = "auto";
        }}
        castShadow
      >
        <RoundedBox args={[0.32, 0.16, 0.1]} radius={0.02} smoothness={3}>
          <meshStandardMaterial
            color={active ? activeColor : "#4a4a4e"}
            metalness={0.7}
            roughness={0.35}
            emissive={active ? activeColor : "#000"}
            emissiveIntensity={active ? 0.4 : 0}
          />
        </RoundedBox>
      </mesh>
      <Text
        position={[0, 0, 0.06]}
        fontSize={0.07}
        color={active ? "#fff" : "#9a9a9e"}
        anchorX="center"
        anchorY="middle"
      >
        {label}
      </Text>
    </group>
  );
}

/* ============================================================
 * 可拖动的卡带包装器 —— 处理 pointer 拖动 + 装配判定
 * ============================================================ */
function DraggableCassette({
  loaded,
  lidOpen,
  songName,
  onLoad,
  onEject,
}: {
  loaded: boolean;
  lidOpen: boolean;
  songName: string;
  onLoad: () => void;
  onEject: () => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const { camera, gl } = useThree();
  const [dragging, setDragging] = useState(false);
  // 目标位置（lerp 过渡用）
  const targetPos = useRef<THREE.Vector3>(new THREE.Vector3());
  const targetRot = useRef<THREE.Euler>(new THREE.Euler(0, 0, 0));
  const dragPlane = useRef<THREE.Plane>(new THREE.Plane());
  const dragOffset = useRef<THREE.Vector3>(new THREE.Vector3());

  // 根据状态设定目标位置
  useFrame(() => {
    const g = groupRef.current;
    if (!g) return;
    if (!dragging) {
      // 非拖动：lerp 到目标
      if (loaded) {
        // 装入：卡带在仓内
        targetPos.current.set(0, 0.25, 0);
        targetRot.current.set(0, 0, 0);
      } else if (lidOpen) {
        // 弹出：浮在仓上方
        targetPos.current.set(0, 1.15, 0.15);
        targetRot.current.set(0, 0, 0);
      } else {
        // 待装：浮在右侧
        targetPos.current.set(2.6, 1.1, 0);
        targetRot.current.set(0, -0.5, 0);
      }
    }
    g.position.lerp(targetPos.current, dragging ? 1 : 0.12);
    g.rotation.x = lerp(g.rotation.x, targetRot.current.x, 0.12);
    g.rotation.y = lerp(g.rotation.y, targetRot.current.y, 0.12);
    g.rotation.z = lerp(g.rotation.z, targetRot.current.z, 0.12);
  });

  // 拖动开始
  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    // 仅在未装入 或 盖板打开时允许拖动
    if (loaded && !lidOpen) return;
    setDragging(true);
    document.body.style.cursor = "grabbing";
    // 拖动平面：经过当前点、法向量为相机视线方向
    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    dragPlane.current.setFromNormalAndCoplanarPoint(
      camDir.negate(),
      e.point.clone()
    );
    // 记录偏移
    dragOffset.current.copy(e.point).sub(groupRef.current!.position);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (!dragging) return;
    e.stopPropagation();
    // 射线交拖动平面
    const ray = e.ray;
    const hit = new THREE.Vector3();
    if (ray.intersectPlane(dragPlane.current, hit)) {
      targetPos.current.copy(hit).sub(dragOffset.current);
      // 限制范围
      targetPos.current.x = clamp(targetPos.current.x, -2.5, 2.8);
      targetPos.current.y = clamp(targetPos.current.y, 0.4, 2.2);
      targetPos.current.z = clamp(targetPos.current.z, -1.2, 1.5);
    }
  };

  const onPointerUp = (e: ThreeEvent<PointerEvent>) => {
    if (!dragging) return;
    e.stopPropagation();
    setDragging(false);
    document.body.style.cursor = "auto";
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    // 判定是否装入：靠近仓口（y<0.7 且 |x|<0.9）
    const p = groupRef.current?.position;
    if (p && !loaded && p.y < 0.85 && Math.abs(p.x) < 0.95) {
      onLoad();
    }
  };

  // 双击卡带 = 弹出/装入快捷
  const onDoubleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (loaded) onEject();
    else if (!lidOpen) {
      // 不在仓内且盖板关着，先开盖
    }
  };

  void gl;

  return (
    <group
      ref={groupRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={onDoubleClick}
      onPointerOver={(e) => {
        e.stopPropagation();
        if (!loaded || lidOpen) document.body.style.cursor = "grab";
      }}
      onPointerOut={() => {
        document.body.style.cursor = "auto";
      }}
    >
      <Cassette
        position={[0, 0, 0]}
        rotation={[0, 0, 0]}
        dragging={dragging}
        songName={songName}
      />
    </group>
  );
}

/* ============================================================
 * Hook: trackUrl 变化时加载音频到引擎
 * ============================================================ */
function useEffectAudioLoad(
  audioEngine: React.MutableRefObject<TapeAudioEngine | null>,
  trackUrl: string | null,
  setLoaded: (v: boolean) => void,
  durRef: React.MutableRefObject<number>
) {
  useEffect(() => {
    const eng = audioEngine.current;
    if (!eng || !trackUrl) return;
    let cancelled = false;
    setLoaded(false);
    eng.load(trackUrl)
      .then(() => {
        if (cancelled) return;
        durRef.current = eng.duration;
        // 加载完成自动装入卡带
        setLoaded(true);
      })
      .catch(() => {
        /* onError 已由引擎回调处理 */
      });
    return () => {
      cancelled = true;
    };
  }, [audioEngine, trackUrl, setLoaded, durRef]);
}

/* ============================================================
 * 主场景 —— 接入真实 TapeAudioEngine
 * ============================================================ */
function Scene({
  audioEngine,
  trackUrl,
  songName,
  loaded,
  setLoaded,
  playing,
  setPlaying,
  direction,
  setDirection,
  lidOpen,
  setLidOpen,
  onEnded,
}: {
  audioEngine: React.MutableRefObject<TapeAudioEngine | null>;
  trackUrl: string | null;
  songName: string;
  loaded: boolean;
  setLoaded: (v: boolean) => void;
  playing: boolean;
  setPlaying: (v: boolean) => void;
  direction: Direction;
  setDirection: (d: Direction) => void;
  lidOpen: boolean;
  setLidOpen: (v: boolean) => void;
  onEnded: () => void;
}) {
  const reelAngleRef = useRef(0);
  const rateRef = useRef(0);
  const audioDurRef = useRef(0);

  // 带卷角速度 + 同步音频 playhead；FF/REW 时驱动音频倍速
  useFrame((_, dt) => {
    const eng = audioEngine.current;
    // 推进音频时间估算
    if (eng) eng.tick(dt);

    let target = 0;
    if (direction === "forward") target = 8;
    else if (direction === "rewind") target = -8;
    else if (playing) target = 1.4;
    rateRef.current = lerp(rateRef.current, target, 0.1);
    reelAngleRef.current += rateRef.current * dt;

    // FF/REW 时实时驱动音频倍速 + seek
    if (eng && direction !== "stop") {
      const rate = Math.abs(rateRef.current);
      eng.setRate(Math.max(0.5, rate));
      eng.setReverse(direction === "rewind");
      if (!eng.isPlaying) eng.play();
      // 边界处理
      const t = eng.currentTime;
      const d = audioDurRef.current;
      if (direction === "rewind" && t <= 0.05) {
        eng.seek(0);
        setDirection("stop");
        eng.pause();
        onEnded();
      } else if (direction === "forward" && d > 0 && t >= d - 0.05) {
        eng.seek(d);
        setDirection("stop");
        eng.pause();
        onEnded();
      }
    } else if (eng && playing) {
      eng.setReverse(false);
      eng.setRate(1);
      if (!eng.isPlaying) eng.play();
    }
  });

  const onButton = (btn: "rew" | "play" | "stop" | "ff" | "eject") => {
    const eng = audioEngine.current;
    if (btn === "play") {
      if (!loaded || !eng) return;
      eng.resume();
      if (playing) {
        eng.pause();
        setPlaying(false);
      } else {
        eng.setReverse(false);
        eng.setRate(1);
        eng.play();
        setPlaying(true);
      }
      setDirection("stop");
    } else if (btn === "stop") {
      if (eng) {
        eng.pause();
        eng.setRate(1);
        eng.setReverse(false);
      }
      setPlaying(false);
      setDirection("stop");
    } else if (btn === "ff") {
      if (!loaded || !eng) return;
      const newDir = direction === "forward" ? "stop" : "forward";
      setDirection(newDir);
      setPlaying(false);
      if (newDir === "stop") {
        eng.setRate(1);
        eng.setReverse(false);
        eng.pause();
      }
    } else if (btn === "rew") {
      if (!loaded || !eng) return;
      const newDir = direction === "rewind" ? "stop" : "rewind";
      setDirection(newDir);
      setPlaying(false);
      if (newDir === "stop") {
        eng.setRate(1);
        eng.setReverse(false);
        eng.pause();
      }
    } else if (btn === "eject") {
      if (loaded) {
        if (eng) {
          eng.pause();
          eng.setRate(1);
          eng.setReverse(false);
        }
        setLidOpen(true);
        setLoaded(false);
        setPlaying(false);
        setDirection("stop");
      } else if (lidOpen) {
        setLidOpen(false);
      }
    }
  };

  const handleLoad = () => {
    setLoaded(true);
    setLidOpen(false);
  };

  const handleEject = () => {
    const eng = audioEngine.current;
    if (eng) {
      eng.pause();
      eng.setRate(1);
      eng.setReverse(false);
    }
    setLidOpen(true);
    setLoaded(false);
    setPlaying(false);
    setDirection("stop");
  };

  // 当 trackUrl 变化且有引擎时，加载音频并更新 duration
  useEffectAudioLoad(audioEngine, trackUrl, setLoaded, audioDurRef);

  return (
    <>
      <PerspectiveCamera makeDefault position={[3.5, 2.4, 4.8]} fov={38} />
      <OrbitControls
        enablePan
        enableZoom
        enableRotate
        minDistance={3}
        maxDistance={9}
        minPolarAngle={Math.PI / 6}
        maxPolarAngle={Math.PI / 2.05}
        target={[0, 0.2, 0]}
        enableDamping
        dampingFactor={0.08}
        panSpeed={0.6}
        rotateSpeed={0.7}
      />

      {/* 灯光：暖色主光 + 冷色 rim + 充足环境/半球光（替代 HDR 反射） */}
      <ambientLight intensity={0.7} color="#fff4e0" />
      <hemisphereLight args={["#eef2ff", "#2a2018", 0.6]} />
      <directionalLight
        position={[4, 6, 3]}
        intensity={1.4}
        color="#ffe8c8"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0005}
        shadow-camera-left={-4}
        shadow-camera-right={4}
        shadow-camera-top={4}
        shadow-camera-bottom={-4}
        shadow-camera-near={0.5}
        shadow-camera-far={20}
      />
      <spotLight
        position={[-3, 4, -4]}
        angle={0.5}
        penumbra={0.8}
        intensity={1.5}
        color="#8aaaff"
        castShadow={false}
      />
      {/* 前面板补光：照亮按钮区，避免阴影淹没细节 */}
      <pointLight position={[0, 0.5, 5]} intensity={0.9} color="#ffd0a0" distance={14} />
      <pointLight position={[0, 3, 2]} intensity={0.5} color="#ffffff" distance={12} />
      <pointLight position={[-3, 1, 3]} intensity={0.4} color="#ffe0c0" distance={10} />

      {/* 地面接触阴影 */}
      <ContactShadows
        position={[0, -0.5, 0]}
        opacity={0.55}
        scale={10}
        blur={2.2}
        far={4}
        resolution={1024}
        color="#000000"
      />

      {/* 地面（深色磨砂） */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]} receiveShadow>
        <planeGeometry args={[30, 30]} />
        <meshStandardMaterial color="#15151a" roughness={0.95} metalness={0.1} />
      </mesh>

      {/* 磁带机 */}
      <Deck
        loaded={loaded}
        playing={playing}
        direction={direction}
        lidOpen={lidOpen}
        onButton={onButton}
        reelAngleRef={reelAngleRef}
      />

      {/* 卡带（可拖动） */}
      <DraggableCassette
        loaded={loaded}
        lidOpen={lidOpen}
        songName={songName}
        onLoad={handleLoad}
        onEject={handleEject}
      />
    </>
  );
}

/* ============================================================
 * 错误边界：3D 渲染出错时显示提示，而非卡在 loading
 * ============================================================ */
class Scene3DErrorBoundary extends Component<
  { children: ReactNode; onError?: (msg: string) => void },
  { error: string | null }
> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  componentDidCatch(e: unknown) {
    this.props.onError?.(e instanceof Error ? e.message : String(e));
  }
  render() {
    if (this.state.error) {
      return (
        <mesh position={[0, 0.5, 0]}>
          <Text
            fontSize={0.12}
            color="#ff6a6a"
            anchorX="center"
            anchorY="middle"
            maxWidth={4}
          >
            {`3D 场景错误\n${this.state.error}`}
          </Text>
        </mesh>
      );
    }
    return this.props.children;
  }
}

/* ============================================================
 * 默认导出：Canvas 容器
 * 状态由父组件持有（loaded/playing/direction/lidOpen + trackUrl/songName），
 * 这里的 Scene 接入真实 TapeAudioEngine。
 * ============================================================ */
export interface CassetteDeck3DCanvasProps {
  audioEngine: React.MutableRefObject<TapeAudioEngine | null>;
  trackUrl: string | null;
  songName: string;
  loaded: boolean;
  setLoaded: (v: boolean) => void;
  playing: boolean;
  setPlaying: (v: boolean) => void;
  direction: Direction;
  setDirection: (d: Direction) => void;
  lidOpen: boolean;
  setLidOpen: (v: boolean) => void;
  onEnded: () => void;
}

export default function CassetteDeck3DCanvas({
  audioEngine,
  trackUrl,
  songName,
  loaded,
  setLoaded,
  playing,
  setPlaying,
  direction,
  setDirection,
  lidOpen,
  setLidOpen,
  onEnded,
}: CassetteDeck3DCanvasProps) {
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      gl={{
        antialias: true,
        // 不用 ACESFilmic（会压暗高光），直接线性输出，色彩更亮更通透
        toneMapping: THREE.NoToneMapping,
      }}
      style={{ width: "100%", height: "100%", touchAction: "none" }}
    >
      <color attach="background" args={["#1c1c22"]} />
      <fog attach="fog" args={["#1c1c22", 10, 22]} />
      <Suspense fallback={null}>
        <Scene3DErrorBoundary>
          <Scene
            audioEngine={audioEngine}
            trackUrl={trackUrl}
            songName={songName}
            loaded={loaded}
            setLoaded={setLoaded}
            playing={playing}
            setPlaying={setPlaying}
            direction={direction}
            setDirection={setDirection}
            lidOpen={lidOpen}
            setLidOpen={setLidOpen}
            onEnded={onEnded}
          />
        </Scene3DErrorBoundary>
      </Suspense>
    </Canvas>
  );
}

// 占位避免未使用导入报错（JSX 命名空间在 R3F 中由 @react-three/fiber 提供）
export type _JSXRef = JSX.Element;
