'use client';

import * as THREE from 'three';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { ContactShadows, Environment, Lightformer, PerformanceMonitor } from '@react-three/drei';
import { INK, Painted, paintBeam, paintCaption, paintCard, paintDot, paintPill, paintSheet, repaintWhenFontsReady, type SheetProfile } from './scene-textures';

/**
 * Recruiter's hero: a pile of CVs on the desk is read by the AI, and the five
 * strongest sheets rise into a ranked shortlist with their match scores, then
 * settle back for the next batch. Paper, light and shadow — every sheet is a
 * painted canvas, so nothing here is DOM.
 */

type NumRef = { current: number };
type FlagRef = { current: boolean };

const SHEET_W = 1;
const SHEET_H = 1.414;
const SHEET_T = 0.012;
const CHIP_W = 0.66;
const CHIP_H = 0.225;

const CYCLE = 14;
const SCAN_FROM = 0.2;
const SCAN_TO = 1.75;
const LIFT_AT = 1.3;
const LIFT_GAP = 0.42;
const FLIGHT = 1.15;
const RETURN_AT = 10.3;
const RETURN_GAP = 0.28;
const RETURN_FLIGHT = 0.95;

const PILE_ORIGIN = new THREE.Vector3(-1.25, 0, 0.3);
const SLOT_ORIGIN = new THREE.Vector3(0.95, 0.74, 0.5);
const SLOT_STEP = new THREE.Vector3(0.1, 0.26, -0.27);
const SCAN_X_FROM = -2.25;
const SCAN_X_TO = -0.3;

const WHITE = new THREE.Color(INK.white);
const LILAC = new THREE.Color(INK.brandSoft);

interface Ranked extends SheetProfile {
  score: number;
}

// Fictional candidates for one search: "Senior backend engineer".
const SHORTLIST: Ranked[] = [
  {
    initials: 'CO', name: 'Chidinma Okafor', role: 'Senior backend engineer', meta: 'Lagos · 7 yrs experience',
    skills: ['Go', 'Postgres', 'Kafka', 'AWS'],
    roles: [['Backend lead · Payments scale-up', 0.82, 0.64], ['Engineer · Fintech platform', 0.7, 0.52], ['Engineer · Software agency', 0.6, 0.4]],
    education: 'B.Sc. Computer Science · University of Lagos', score: 95,
  },
  {
    initials: 'TA', name: 'Tunde Adeyemi', role: 'Backend engineer', meta: 'Abuja · 5 yrs experience',
    skills: ['Node.js', 'TypeScript', 'Redis', 'GCP'],
    roles: [['Senior engineer · Logistics platform', 0.76, 0.58], ['Engineer · E-commerce marketplace', 0.66, 0.48], ['Junior engineer · Bank', 0.5, 0.36]],
    education: 'B.Eng. Software Engineering · Covenant University', score: 91,
  },
  {
    initials: 'ZB', name: 'Zainab Bello', role: 'Platform engineer', meta: 'Remote · 6 yrs experience',
    skills: ['Python', 'Kubernetes', 'Terraform'],
    roles: [['Platform engineer · Health-tech', 0.8, 0.6], ['DevOps engineer · Telecoms', 0.68, 0.5], ['Systems engineer · ISP', 0.56, 0.42]],
    education: 'B.Sc. Computer Engineering · ABU Zaria', score: 88,
  },
  {
    initials: 'EO', name: 'Emeka Obi', role: 'Software engineer', meta: 'Port Harcourt · 4 yrs experience',
    skills: ['Java', 'Spring', 'MySQL'],
    roles: [['Software engineer · Insurance', 0.74, 0.54], ['Engineer · Energy services', 0.62, 0.46], ['Intern · Software house', 0.44, 0.3]],
    education: 'B.Sc. Computer Science · UNIPORT', score: 84,
  },
  {
    initials: 'NE', name: 'Ngozi Eze', role: 'Full-stack developer', meta: 'Enugu · 3 yrs experience',
    skills: ['React', 'Node.js', 'MongoDB'],
    roles: [['Full-stack developer · Ed-tech', 0.72, 0.5], ['Developer · Digital agency', 0.6, 0.44], ['Intern · Startup studio', 0.42, 0.3]],
    education: 'B.Sc. Information Technology · UNN', score: 79,
  },
];

const OTHERS: SheetProfile[] = [
  { initials: 'AB', name: 'Adaeze Bankole', role: 'Frontend developer', meta: 'Lagos · 2 yrs experience', skills: ['React', 'CSS', 'Figma'], roles: [['Frontend developer · Media', 0.7, 0.5], ['Intern · Design studio', 0.5, 0.36], ['Freelance', 0.4, 0.3]], education: 'B.Sc. Computer Science · LASU' },
  { initials: 'KM', name: 'Kelechi Musa', role: 'QA analyst', meta: 'Kano · 4 yrs experience', skills: ['Cypress', 'Jira', 'SQL'], roles: [['QA analyst · Bank', 0.72, 0.52], ['Tester · Telecoms', 0.6, 0.44], ['Support · ISP', 0.46, 0.3]], education: 'B.Sc. Mathematics · BUK' },
  { initials: 'FI', name: 'Funke Ibrahim', role: 'Data analyst', meta: 'Ibadan · 3 yrs experience', skills: ['SQL', 'Python', 'Power BI'], roles: [['Data analyst · Retail', 0.7, 0.5], ['Analyst · Consulting', 0.58, 0.42], ['Intern · NGO', 0.4, 0.3]], education: 'B.Sc. Statistics · University of Ibadan' },
  { initials: 'SD', name: 'Seun Dada', role: 'Mobile developer', meta: 'Lagos · 5 yrs experience', skills: ['Flutter', 'Kotlin', 'Firebase'], roles: [['Mobile developer · Fintech', 0.78, 0.56], ['Android developer · Agency', 0.64, 0.46], ['Junior developer · Startup', 0.48, 0.34]], education: 'B.Tech. Computer Science · FUTA' },
];

interface SheetSpec {
  profile: SheetProfile;
  pileIndex: number;
  /** Rank in the shortlist, or null for a sheet that stays in the pile. */
  rank: number | null;
  score?: number;
}

// Pile order, bottom to top: the four unranked sheets, then the shortlist with #1 on top.
const SHEETS: SheetSpec[] = [
  ...OTHERS.map((profile, i) => ({ profile, pileIndex: i, rank: null })),
  ...[...SHORTLIST].reverse().map((profile, i) => ({ profile, pileIndex: OTHERS.length + i, rank: SHORTLIST.length - 1 - i, score: profile.score })),
];

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (x: number) => x * x * (3 - 2 * x);
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const backOut = (x: number) => 1 + 2.70158 * Math.pow(x - 1, 3) + 1.70158 * Math.pow(x - 1, 2);
const seeded = (seed: number) => {
  let s = seed * 9301 + 49297;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
};

interface ScanState {
  x: number;
  on: number;
}

interface SheetProps {
  spec: SheetSpec;
  clockRef: NumRef;
  scanRef: { current: ScanState };
  sheetTexture: THREE.Texture;
  chipTexture?: THREE.Texture;
}

function Sheet({ spec, clockRef, scanRef, sheetTexture, chipTexture }: SheetProps) {
  const mesh = useRef<THREE.Mesh>(null);
  const front = useRef<THREE.MeshStandardMaterial>(null);
  const chip = useRef<THREE.Sprite>(null);
  const halo = useRef<THREE.MeshBasicMaterial>(null);

  const pose = useMemo(() => {
    const rand = seeded(spec.pileIndex + 3);
    const pilePos = new THREE.Vector3(
      PILE_ORIGIN.x + (rand() - 0.5) * 0.14,
      PILE_ORIGIN.y + SHEET_T * spec.pileIndex + SHEET_T / 2,
      PILE_ORIGIN.z + (rand() - 0.5) * 0.14,
    );
    // Spin in the sheet's own plane, then lay it flat.
    const pileQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, (rand() - 0.5) * 0.36, 'XYZ'));
    const slotPos = spec.rank === null ? pilePos.clone() : SLOT_ORIGIN.clone().addScaledVector(SLOT_STEP, spec.rank);
    const slotQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.16, 0, 0));
    return { pilePos, pileQuat, slotPos, slotQuat, tmp: new THREE.Vector3() };
  }, [spec.pileIndex, spec.rank]);

  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    const time = clockRef.current;
    const u = time % CYCLE;
    const scan = scanRef.current;
    const pulse = scan.on * Math.exp(-Math.pow((scan.x - pose.pilePos.x) / 0.42, 2));

    if (spec.rank === null) {
      m.position.copy(pose.pilePos);
      m.position.y += pulse * 0.02;
      m.quaternion.copy(pose.pileQuat);
      front.current?.color.lerpColors(WHITE, LILAC, pulse * 0.9);
      return;
    }

    const rank = spec.rank;
    const out = easeInOut(clamp01((u - (LIFT_AT + rank * LIFT_GAP)) / FLIGHT));
    const back = easeInOut(clamp01((u - (RETURN_AT + (SHORTLIST.length - 1 - rank) * RETURN_GAP)) / RETURN_FLIGHT));
    const p = out * (1 - back);

    pose.tmp.lerpVectors(pose.pilePos, pose.slotPos, p);
    pose.tmp.y += Math.sin(Math.PI * p) * 0.85 + Math.sin(time * 1.4 + rank * 1.7) * 0.012 * p;
    m.position.copy(pose.tmp);
    m.quaternion.slerpQuaternions(pose.pileQuat, pose.slotQuat, p);
    front.current?.color.lerpColors(WHITE, LILAC, pulse * (1 - p) * 0.9);

    if (chip.current) {
      const arrive = LIFT_AT + rank * LIFT_GAP + FLIGHT;
      const pop = backOut(clamp01((u - (arrive + 0.06)) / 0.55));
      const hide = 1 - smooth(clamp01((u - (RETURN_AT + (SHORTLIST.length - 1 - rank) * RETURN_GAP - 0.4)) / 0.3));
      const s = Math.max(0, pop * hide) * p;
      chip.current.scale.set(CHIP_W * s, CHIP_H * s, 1);
      chip.current.visible = s > 0.002;
    }
    if (halo.current) halo.current.opacity = (0.16 + Math.sin(time * 2.2) * 0.05) * p;
  });

  return (
    <mesh ref={mesh}>
      <boxGeometry args={[SHEET_W, SHEET_H, SHEET_T]} />
      <meshStandardMaterial attach="material-0" color={INK.paperEdge} roughness={0.95} />
      <meshStandardMaterial attach="material-1" color={INK.paperEdge} roughness={0.95} />
      <meshStandardMaterial attach="material-2" color={INK.paperEdge} roughness={0.95} />
      <meshStandardMaterial attach="material-3" color={INK.paperEdge} roughness={0.95} />
      <meshStandardMaterial ref={front} attach="material-4" map={sheetTexture} roughness={0.92} />
      <meshStandardMaterial attach="material-5" color={INK.surface} roughness={0.95} />
      {spec.rank === 0 && (
        <mesh position={[0, 0, -0.02]}>
          <planeGeometry args={[SHEET_W + 0.12, SHEET_H + 0.12]} />
          <meshBasicMaterial ref={halo} color={INK.brand} transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
      {chipTexture && (
        <sprite ref={chip} position={[0.34, SHEET_H / 2 - 0.02, 0.08]} scale={[0, 0, 1]}>
          <spriteMaterial map={chipTexture} transparent depthWrite={false} />
        </sprite>
      )}
    </mesh>
  );
}

interface ScannerProps {
  clockRef: NumRef;
  scanRef: { current: ScanState };
  beamTexture: THREE.Texture;
  dotTexture: THREE.Texture;
}

const DOTS = 28;

/** The reading beam: a bar of brand light that sweeps the pile, lifting flecks of parsed data. */
function Scanner({ clockRef, scanRef, beamTexture, dotTexture }: ScannerProps) {
  const group = useRef<THREE.Group>(null);
  const light = useRef<THREE.PointLight>(null);
  const bar = useRef<THREE.MeshBasicMaterial>(null);
  const beam = useRef<THREE.MeshBasicMaterial>(null);
  const dots = useRef<THREE.PointsMaterial>(null);
  const seeds = useMemo(() => {
    const rand = seeded(11);
    return Array.from({ length: DOTS }, () => [rand(), rand(), rand()] as const);
  }, []);
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DOTS * 3), 3));
    return g;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame(() => {
    const u = clockRef.current % CYCLE;
    const k = clamp01((u - SCAN_FROM) / (SCAN_TO - SCAN_FROM));
    const fade = k <= 0 || k >= 1 ? 0 : Math.min(smooth(clamp01(k / 0.14)), smooth(clamp01((1 - k) / 0.14)));
    const x = THREE.MathUtils.lerp(SCAN_X_FROM, SCAN_X_TO, easeInOut(k));
    scanRef.current.x = x;
    scanRef.current.on = fade;
    if (group.current) group.current.position.x = x;
    if (bar.current) bar.current.opacity = fade;
    if (beam.current) beam.current.opacity = 0.9 * fade;
    if (light.current) light.current.intensity = 5 * fade;

    const position = geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < DOTS; i++) {
      const [a, b, c] = seeds[i];
      const life = (k * 2.4 + a) % 1;
      position.setXYZ(i, (b - 0.5) * 0.5, 0.12 + life * 0.85, (c - 0.5) * 1.4);
    }
    position.needsUpdate = true;
    if (dots.current) dots.current.opacity = 0.9 * fade;
  });

  return (
    <group ref={group} position={[SCAN_X_FROM, 0, PILE_ORIGIN.z]}>
      <mesh position={[0, 0.5, 0]}>
        <boxGeometry args={[0.028, 0.028, 1.9]} />
        <meshBasicMaterial ref={bar} color={INK.brand} transparent opacity={0} />
      </mesh>
      <mesh position={[0, 0.25, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[1.9, 0.5]} />
        <meshBasicMaterial ref={beam} map={beamTexture} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <pointLight ref={light} color={INK.brand} distance={3.2} decay={2} intensity={0} position={[0, 0.55, 0]} />
      <points geometry={geometry}>
        <pointsMaterial ref={dots} map={dotTexture} color={INK.brand} size={0.055} sizeAttenuation transparent opacity={0} depthWrite={false} />
      </points>
    </group>
  );
}

interface RigProps {
  clockRef: NumRef;
  hoverRef: FlagRef;
  spreadRef: NumRef;
  children: ReactNode;
}

/** Advances the scene clock (slower under the pointer) and leans the whole set with the cursor and scroll. */
function Rig({ clockRef, hoverRef, spreadRef, children }: RigProps) {
  const group = useRef<THREE.Group>(null);
  const speed = useRef(1);
  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1);
    speed.current = THREE.MathUtils.damp(speed.current, hoverRef.current ? 0.35 : 1, 3, dt);
    clockRef.current += dt * speed.current;
    const g = group.current;
    if (!g) return;
    g.rotation.y = THREE.MathUtils.damp(g.rotation.y, state.pointer.x * 0.07, 4, dt);
    g.rotation.x = THREE.MathUtils.damp(g.rotation.x, -state.pointer.y * 0.035, 4, dt);
    g.position.y = THREE.MathUtils.damp(g.position.y, -spreadRef.current * 0.9, 4, dt);
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

/** The role the pile is being ranked against, floating above the inbox. */
function JobCard({ clockRef, texture }: { clockRef: NumRef; texture: THREE.Texture }) {
  const mesh = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    const t = clockRef.current;
    m.position.set(-1.2, 1.62 + Math.sin(t * 0.8) * 0.035, -0.45);
    m.rotation.set(-0.08 + Math.sin(t * 0.5) * 0.02, 0.3, 0.02);
  });
  return (
    <mesh ref={mesh} position={[-1.2, 1.62, -0.45]}>
      <planeGeometry args={[1.6, 0.5]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} />
    </mesh>
  );
}

function Caption({ texture, position, width }: { texture: THREE.Texture; position: [number, number, number]; width: number }) {
  return (
    <sprite position={position} scale={[width, width * 0.23, 1]}>
      <spriteMaterial map={texture} transparent depthWrite={false} />
    </sprite>
  );
}

interface ShortlistSceneProps {
  active?: boolean;
  compact?: boolean;
  /** 0 while the hero is in view, 1 once it has scrolled away. */
  spreadRef: NumRef;
  /** True while the pointer is over the hero frame. */
  hoverRef: FlagRef;
}

export default function ShortlistScene({ active = true, compact = false, spreadRef, hoverRef }: ShortlistSceneProps) {
  const [dpr, setDpr] = useState(1.5);
  const clockRef = useRef(0);
  const scanRef = useRef<ScanState>({ x: SCAN_X_FROM, on: 0 });
  const target = useMemo<[number, number, number]>(() => [0.1, 0.95, 0], []);

  const art = useMemo(() => {
    const sheets = SHEETS.map((spec) => new Painted(1024, 1448, paintSheet(spec.profile), 16));
    const chips = SHEETS.map((spec) =>
      spec.score === undefined
        ? undefined
        : new Painted(512, 176, paintPill(`${spec.score}% match`, { fill: spec.rank === 0 ? INK.positive : INK.brand, color: INK.white, size: 74 })),
    );
    const inbox = new Painted(768, 176, paintCaption('INBOX · 48 CVs'));
    const shortlist = new Painted(768, 176, paintCaption('AI SHORTLIST · TOP 5'));
    const job = new Painted(1024, 320, paintCard('OPEN ROLE', 'Senior backend engineer', 'Lagos · Hybrid · 48 applicants'));
    const beam = new Painted(16, 128, paintBeam(INK.brand));
    const dot = new Painted(64, 64, paintDot(INK.brand));
    return { sheets, chips, inbox, shortlist, job, beam, dot };
  }, []);

  useEffect(() => {
    const all = [...art.sheets, ...art.chips.filter((c): c is Painted => Boolean(c)), art.inbox, art.shortlist, art.job];
    repaintWhenFontsReady(all);
    return () => {
      [...all, art.beam, art.dot].forEach((item) => item.dispose());
    };
  }, [art]);

  return (
    <Canvas
      flat
      frameloop={active ? 'always' : 'never'}
      dpr={dpr}
      camera={{ position: [0.3, 3.65, compact ? 9.2 : 8.1], fov: 28 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      style={{ position: 'absolute', inset: 0, background: 'transparent' }}
    >
      <PerformanceMonitor onDecline={() => setDpr(1)} onIncline={() => setDpr(1.5)} />
      <LookAt target={target} />
      <ambientLight intensity={1.35} />
      <directionalLight position={[2.5, 6, 4]} intensity={1.9} />
      <directionalLight position={[-4, 3, -2]} intensity={0.6} color="#dcd2ff" />

      <Rig clockRef={clockRef} hoverRef={hoverRef} spreadRef={spreadRef}>
        {SHEETS.map((spec, i) => (
          <Sheet key={spec.profile.name} spec={spec} clockRef={clockRef} scanRef={scanRef} sheetTexture={art.sheets[i].texture} chipTexture={art.chips[i]?.texture} />
        ))}
        <Scanner clockRef={clockRef} scanRef={scanRef} beamTexture={art.beam.texture} dotTexture={art.dot.texture} />
        <Caption texture={art.inbox.texture} position={[-1.2, 0.02, 1.3]} width={0.85} />
        <Caption texture={art.shortlist.texture} position={[1.2, 0.02, 1.25]} width={1.0} />
        <JobCard clockRef={clockRef} texture={art.job.texture} />
        <ContactShadows position={[0, -0.003, 0]} opacity={0.34} scale={9} blur={2.4} far={3.4} resolution={512} color="#2d2838" />
      </Rig>

      <Environment resolution={64}>
        <Lightformer form="circle" intensity={1.1} color="#ffffff" position={[-3, 5, 4]} scale={3} />
        <Lightformer form="circle" intensity={0.45} color="#c4b5fd" position={[4, 2, -5]} scale={6} />
      </Environment>
    </Canvas>
  );
}
