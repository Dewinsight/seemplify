'use client';

import * as THREE from 'three';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { ContactShadows, Environment, Lightformer, PerformanceMonitor, RoundedBox } from '@react-three/drei';
import { INK, Painted, paintLane, paintPill, repaintWhenFontsReady } from './scene-textures';

/**
 * "One slot, three clocks": a calendar board with a lane per city. Existing
 * meetings sit on the lanes as blocks; a glass interview window slides along
 * looking for an hour that is free in Lagos, New York and Nairobi at once,
 * turns amber on each conflict, and locks green when it finds the slot —
 * revealing the local time in every zone.
 */

type NumRef = { current: number };

const CYCLE = 12;
const DROP_END = 0.7;
const SEG1_START = 1.1;
const SEG1_END = 2.0;
const SEG2_START = 2.8;
const SEG2_END = 3.7;
const CHIPS_HIDE = 9.4;
const GATE_HIDE = 9.8;
const SHUFFLE_AT = 10.2;

const LANE_X0 = -1.0;
const LANE_LEN = 2.8;
const LANE_D = 0.78;
const LANE_Z = [-1, 0, 1];
const GATE_W = 0.48;
const GATE_H = 0.82;
const GATE_D = 2.8;
const CHIP_W = 0.66;
const CHIP_H = 0.29;

const LANES = [
  { city: 'Lagos', zone: 'WAT', time: '14:00' },
  { city: 'New York', zone: 'EDT', time: '09:00' },
  { city: 'Nairobi', zone: 'EAT', time: '16:00' },
];

interface Block {
  lane: number;
  /** Centre and width as fractions of the lane. */
  f: number;
  fw: number;
}

interface Layout {
  blocks: Block[];
  /** Where the window starts, the conflict it tries next, and the free slot it finds. */
  path: [number, number, number];
}

const LAYOUTS: Layout[] = [
  {
    blocks: [
      { lane: 0, f: 0.171, fw: 0.2 }, { lane: 0, f: 0.543, fw: 0.143 }, { lane: 0, f: 0.871, fw: 0.114 },
      { lane: 1, f: 0.1, fw: 0.143 }, { lane: 1, f: 0.414, fw: 0.157 }, { lane: 1, f: 0.9, fw: 0.143 },
      { lane: 2, f: 0.257, fw: 0.171 }, { lane: 2, f: 0.557, fw: 0.129 }, { lane: 2, f: 0.914, fw: 0.114 },
    ],
    path: [0.071, 0.414, 0.714],
  },
  {
    blocks: [
      { lane: 0, f: 0.071, fw: 0.114 }, { lane: 0, f: 0.471, fw: 0.2 }, { lane: 0, f: 0.8, fw: 0.171 },
      { lane: 1, f: 0.414, fw: 0.143 }, { lane: 1, f: 0.657, fw: 0.143 }, { lane: 1, f: 0.914, fw: 0.114 },
      { lane: 2, f: 0.086, fw: 0.143 }, { lane: 2, f: 0.529, fw: 0.171 }, { lane: 2, f: 0.843, fw: 0.143 },
    ],
    path: [0.843, 0.514, 0.243],
  },
];

const BRAND = new THREE.Color(INK.brand);
const WARNING = new THREE.Color(INK.warning);
const POSITIVE = new THREE.Color(INK.positive);

const laneX = (f: number) => LANE_X0 + f * LANE_LEN;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (x: number) => x * x * (3 - 2 * x);
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
const backOut = (x: number) => 1 + 2.70158 * Math.pow(x - 1, 3) + 1.70158 * Math.pow(x - 1, 2);

/** Which layout is on the board now, and how far the crossfade to the next one has gone. */
function layoutState(time: number) {
  const cycle = Math.floor(time / CYCLE);
  const u = time - cycle * CYCLE;
  const current = cycle % LAYOUTS.length;
  const mix = smooth(clamp01((u - SHUFFLE_AT) / 1.0));
  return { u, current, next: (current + 1) % LAYOUTS.length, mix };
}

function BusyBlocks({ clockRef }: { clockRef: NumRef }) {
  const materials = useRef<Array<Array<THREE.MeshStandardMaterial | null>>>(LAYOUTS.map(() => []));
  const meshes = useRef<Array<Array<THREE.Mesh | null>>>(LAYOUTS.map(() => []));

  useFrame(() => {
    const { current, next, mix } = layoutState(clockRef.current);
    LAYOUTS.forEach((layout, li) => {
      const weight = li === current ? 1 - mix : li === next ? mix : 0;
      layout.blocks.forEach((_, bi) => {
        const material = materials.current[li][bi];
        const mesh = meshes.current[li][bi];
        if (material) material.opacity = weight;
        if (mesh) {
          mesh.visible = weight > 0.001;
          mesh.scale.y = Math.max(0.001, weight);
          mesh.position.y = 0.07 * weight;
        }
      });
    });
  });

  return (
    <>
      {LAYOUTS.map((layout, li) =>
        layout.blocks.map((block, bi) => (
          <RoundedBox
            key={`${li}-${bi}`}
            ref={(el: THREE.Mesh | null) => {
              meshes.current[li][bi] = el;
            }}
            args={[block.fw * LANE_LEN, 0.14, 0.54]}
            radius={0.04}
            smoothness={4}
            position={[laneX(block.f), 0.07, LANE_Z[block.lane]]}
          >
            <meshStandardMaterial
              ref={(el: THREE.MeshStandardMaterial | null) => {
                materials.current[li][bi] = el;
              }}
              color={INK.block}
              roughness={0.9}
              transparent
              opacity={0}
            />
          </RoundedBox>
        )),
      )}
    </>
  );
}

interface GateProps {
  clockRef: NumRef;
  chipTextures: THREE.Texture[];
  labelTexture: THREE.Texture;
}

/** The interview window: translucent slab with a crisp lip, coloured by what it finds under it. */
function Gate({ clockRef, chipTextures, labelTexture }: GateProps) {
  const group = useRef<THREE.Group>(null);
  const fill = useRef<THREE.MeshBasicMaterial>(null);
  const lipMaterial = useMemo(() => new THREE.MeshBasicMaterial({ color: INK.brand, transparent: true, opacity: 0 }), []);
  const sillMaterial = useMemo(() => new THREE.MeshBasicMaterial({ color: INK.brand, transparent: true, opacity: 0 }), []);
  useEffect(() => () => {
    lipMaterial.dispose();
    sillMaterial.dispose();
  }, [lipMaterial, sillMaterial]);
  const label = useRef<THREE.Sprite>(null);
  const chips = useRef<Array<THREE.Sprite | null>>([]);
  const color = useMemo(() => new THREE.Color(INK.brand), []);

  useFrame(() => {
    const time = clockRef.current;
    const { u, current } = layoutState(time);
    const layout = LAYOUTS[current];
    const [a, b, c] = layout.path.map(laneX);

    let x = a;
    if (u >= SEG1_START && u < SEG1_END) x = THREE.MathUtils.lerp(a, b, easeInOut((u - SEG1_START) / (SEG1_END - SEG1_START)));
    else if (u >= SEG1_END && u < SEG2_START) x = b;
    else if (u >= SEG2_START && u < SEG2_END) x = THREE.MathUtils.lerp(b, c, easeInOut((u - SEG2_START) / (SEG2_END - SEG2_START)));
    else if (u >= SEG2_END) x = c;

    // A small shudder on landing at each conflict.
    const shudder = (t0: number) => {
      const dt = u - t0;
      return dt > 0 && dt < 0.4 ? Math.sin(dt * 48) * 0.016 * (1 - dt / 0.4) : 0;
    };
    x += shudder(DROP_END) + shudder(SEG1_END);

    const drop = easeOut(clamp01(u / DROP_END));
    const gone = smooth(clamp01((u - GATE_HIDE) / 0.6));
    const alpha = drop * (1 - gone);
    const locked = u >= SEG2_END && u < GATE_HIDE;
    const conflict = layout.blocks.some((block) => Math.abs(x - laneX(block.f)) < (GATE_W + block.fw * LANE_LEN) / 2 - 0.03);
    color.lerp(conflict ? WARNING : locked ? POSITIVE : BRAND, 0.14);

    const g = group.current;
    if (g) {
      g.position.x = x;
      g.position.y = (1 - drop) * 0.9;
      g.visible = alpha > 0.001;
    }
    if (fill.current) {
      fill.current.color.copy(color);
      fill.current.opacity = 0.22 * alpha;
    }
    for (const mat of [lipMaterial, sillMaterial]) {
      mat.color.copy(color);
      mat.opacity = alpha;
    }
    if (label.current) {
      label.current.scale.set(1.5 * alpha, 0.36 * alpha, 1);
      label.current.position.set(x, 1.3, -1.7);
    }
    chips.current.forEach((chip, i) => {
      if (!chip) return;
      const pop = backOut(clamp01((u - (SEG2_END + 0.12 + i * 0.1)) / 0.5)) * (1 - smooth(clamp01((u - CHIPS_HIDE) / 0.35)));
      const s = Math.max(0, pop);
      chip.scale.set(CHIP_W * s, CHIP_H * s, 1);
      chip.position.set(x + 0.64, 0.3, LANE_Z[i]);
      chip.visible = s > 0.002;
    });
  });

  return (
    <>
      <group ref={group} position={[laneX(LAYOUTS[0].path[0]), 0.9, 0]}>
        <mesh position={[0, GATE_H / 2, 0]}>
          <boxGeometry args={[GATE_W, GATE_H, GATE_D]} />
          <meshBasicMaterial ref={fill} color={INK.brand} transparent opacity={0} depthWrite={false} />
        </mesh>
        {/* Thin rails outline the window instead of solid plates, so the slab stays glassy. */}
        <group position={[0, GATE_H, 0]}>
          <mesh position={[-GATE_W / 2, 0, 0]} material={lipMaterial}><boxGeometry args={[0.022, 0.022, GATE_D + 0.02]} /></mesh>
          <mesh position={[GATE_W / 2, 0, 0]} material={lipMaterial}><boxGeometry args={[0.022, 0.022, GATE_D + 0.02]} /></mesh>
          <mesh position={[0, 0, -GATE_D / 2]} material={lipMaterial}><boxGeometry args={[GATE_W + 0.02, 0.022, 0.022]} /></mesh>
          <mesh position={[0, 0, GATE_D / 2]} material={lipMaterial}><boxGeometry args={[GATE_W + 0.02, 0.022, 0.022]} /></mesh>
        </group>
        <group position={[0, 0.008, 0]}>
          <mesh position={[-GATE_W / 2, 0, 0]} material={sillMaterial}><boxGeometry args={[0.02, 0.014, GATE_D + 0.02]} /></mesh>
          <mesh position={[GATE_W / 2, 0, 0]} material={sillMaterial}><boxGeometry args={[0.02, 0.014, GATE_D + 0.02]} /></mesh>
        </group>
      </group>
      <sprite ref={label} scale={[0, 0, 1]}>
        <spriteMaterial map={labelTexture} transparent depthWrite={false} />
      </sprite>
      {LANES.map((lane, i) => (
        <sprite
          key={lane.city}
          ref={(el) => {
            chips.current[i] = el;
          }}
          scale={[0, 0, 1]}
        >
          <spriteMaterial map={chipTextures[i]} transparent depthWrite={false} />
        </sprite>
      ))}
    </>
  );
}

function Rig({ clockRef, children }: { clockRef: NumRef; children: ReactNode }) {
  const group = useRef<THREE.Group>(null);
  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1);
    clockRef.current += dt;
    const g = group.current;
    if (!g) return;
    g.rotation.y = THREE.MathUtils.damp(g.rotation.y, state.pointer.x * 0.06, 4, dt);
    g.rotation.x = THREE.MathUtils.damp(g.rotation.x, -state.pointer.y * 0.03, 4, dt);
  });
  return <group ref={group}>{children}</group>;
}

function LookAt({ target }: { target: [number, number, number] }) {
  const camera = useThree((state) => state.camera);
  useLayoutEffect(() => {
    camera.lookAt(...target);
  }, [camera, target]);
  return null;
}

interface SchedulerSceneProps {
  active?: boolean;
  compact?: boolean;
}

export default function SchedulerScene({ active = true, compact = false }: SchedulerSceneProps) {
  const [dpr, setDpr] = useState(1.5);
  const clockRef = useRef(0);
  const target = useMemo<[number, number, number]>(() => [0.2, 0.3, 0], []);

  const art = useMemo(() => {
    const lane = new Painted(1024, 232, paintLane(8), 16);
    const cities = LANES.map(
      (l) => new Painted(512, 232, paintPill(l.city, { fill: INK.surface, color: INK.text, stroke: INK.lineStrong, sub: l.zone, subColor: INK.muted, size: 78, shadow: false })),
    );
    const clocks = LANES.map(
      (l) => new Painted(512, 232, paintPill(l.time, { fill: INK.text, color: INK.canvas, sub: `${l.city} · ${l.zone}`, subColor: '#c9c4bb', size: 82 })),
    );
    const label = new Painted(1024, 248, paintPill('Panel interview · 60 min', { fill: INK.surface, color: INK.text, stroke: INK.lineStrong, size: 64, display: false }));
    return { lane, cities, clocks, label };
  }, []);

  useEffect(() => {
    const all = [...art.cities, ...art.clocks, art.label];
    repaintWhenFontsReady(all);
    return () => {
      [...all, art.lane].forEach((item) => item.dispose());
    };
  }, [art]);

  return (
    <Canvas
      flat
      frameloop={active ? 'always' : 'never'}
      dpr={dpr}
      camera={{ position: [0.35, 4.3, compact ? 7.9 : 6.9], fov: 30 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      style={{ position: 'absolute', inset: 0, background: 'transparent' }}
    >
      <PerformanceMonitor onDecline={() => setDpr(1)} onIncline={() => setDpr(1.5)} />
      <LookAt target={target} />
      <ambientLight intensity={1.5} />
      <directionalLight position={[2, 6, 3]} intensity={1.7} />
      <directionalLight position={[-4, 3, -3]} intensity={0.5} color="#dcd2ff" />

      <Rig clockRef={clockRef}>
        {/* The board and its three lanes. */}
        <RoundedBox args={[3.9, 0.1, 2.95]} radius={0.05} smoothness={4} position={[0.2, -0.05, 0]}>
          <meshStandardMaterial color={INK.surface} roughness={0.95} />
        </RoundedBox>
        {/* A darker rim under the board so its edge reads on a light desk. */}
        <RoundedBox args={[3.96, 0.05, 3.01]} radius={0.05} smoothness={4} position={[0.2, -0.11, 0]}>
          <meshStandardMaterial color="#cfc8bc" roughness={0.95} />
        </RoundedBox>
        {LANE_Z.map((z, i) => (
          <group key={z}>
            <mesh rotation-x={-Math.PI / 2} position={[LANE_X0 + LANE_LEN / 2, 0.004, z]}>
              <planeGeometry args={[LANE_LEN, LANE_D]} />
              <meshBasicMaterial map={art.lane.texture} transparent />
            </mesh>
            <sprite position={[LANE_X0 - 0.42, 0.13, z]} scale={[0.68, 0.31, 1]}>
              <spriteMaterial map={art.cities[i].texture} transparent depthWrite={false} />
            </sprite>
          </group>
        ))}

        <BusyBlocks clockRef={clockRef} />
        <Gate clockRef={clockRef} chipTextures={art.clocks.map((c) => c.texture)} labelTexture={art.label.texture} />

        <ContactShadows position={[0, 0.008, 0]} opacity={0.44} scale={[5.6, 3.6]} blur={2.2} far={2.4} resolution={512} color="#2d2838" />
      </Rig>

      <Environment resolution={64}>
        <Lightformer form="circle" intensity={1.1} color="#ffffff" position={[-3, 5, 4]} scale={3} />
        <Lightformer form="circle" intensity={0.45} color="#c4b5fd" position={[4, 2, -5]} scale={6} />
      </Environment>
    </Canvas>
  );
}
