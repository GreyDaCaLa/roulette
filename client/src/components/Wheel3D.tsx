import { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { RED_NUMBERS, WHEEL_ORDER } from '../../../shared/roulette';
import type { SpinInfo } from '../../../shared/types';
import { serverNow } from '../game';

// Geometry (world units)
const R = 2.2; // rotor radius
const STEP = (Math.PI * 2) / WHEEL_ORDER.length;
const POCKET_IN = 0.6 * R;
const POCKET_OUT = 0.78 * R;
const POCKET_R = (POCKET_IN + POCKET_OUT) / 2;
const BALL_R = 0.07;
const TRACK_R = 2.55;
const TRACK_Y = 0.15 + BALL_R;
const REST_Y = BALL_R + 0.005;
const IDLE_SPEED = 0.35; // rad/s
const BALL_LAPS = 7; // laps relative to the rotor during a spin
const DROP_AT = 0.62; // fraction of the spin when the ball leaves the track

const GOLD = '#d4af37';
const WOOD = '#5a3418';
const DARK_WOOD = '#2e1a0c';

/** Angle of a pocket in the rotor's local frame (matches the texture). */
function pocketAngle(n: number) {
  return WHEEL_ORDER.indexOf(n as (typeof WHEEL_ORDER)[number]) * STEP;
}

function makeWheelTexture() {
  const S = 2048;
  const c = S / 2;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d')!;
  const ring = (r: number, color: string, width: number) => {
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  };

  // Outer rim
  ctx.fillStyle = DARK_WOOD;
  ctx.beginPath();
  ctx.arc(c, c, c, 0, Math.PI * 2);
  ctx.fill();

  WHEEL_ORDER.forEach((n, i) => {
    const a = i * STEP;
    const color = n === 0 ? '#0e7a3a' : RED_NUMBERS.has(n) ? '#b3202a' : '#151515';
    // Number + pocket wedge
    ctx.beginPath();
    ctx.arc(c, c, 0.95 * c, a - STEP / 2, a + STEP / 2);
    ctx.arc(c, c, 0.6 * c, a + STEP / 2, a - STEP / 2, true);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    // Divider line
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a + STEP / 2) * 0.6 * c, c + Math.sin(a + STEP / 2) * 0.6 * c);
    ctx.lineTo(c + Math.cos(a + STEP / 2) * 0.95 * c, c + Math.sin(a + STEP / 2) * 0.95 * c);
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 5;
    ctx.stroke();
    // Number, reading outward
    ctx.save();
    ctx.translate(c + Math.cos(a) * 0.865 * c, c + Math.sin(a) * 0.865 * c);
    ctx.rotate(a + Math.PI / 2);
    ctx.fillStyle = '#f4efe1';
    ctx.font = `bold ${Math.round(0.075 * c)}px Georgia, "Times New Roman", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(n), 0, 0);
    ctx.restore();
  });

  // Pocket floors slightly darker than the number ring
  ctx.beginPath();
  ctx.arc(c, c, 0.78 * c, 0, Math.PI * 2);
  ctx.arc(c, c, 0.6 * c, 0, Math.PI * 2, true);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fill('evenodd');

  // Inner wood
  const g = ctx.createRadialGradient(c, c, 0, c, c, 0.6 * c);
  g.addColorStop(0, '#8a5a2b');
  g.addColorStop(1, WOOD);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(c, c, 0.6 * c, 0, Math.PI * 2);
  ctx.fill();

  ring(0.6 * c, GOLD, 8);
  ring(0.78 * c, GOLD, 8);
  ring(0.95 * c, GOLD, 8);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Ball position in the rotor's local frame, derived purely from server time. */
function ballPose(spin: SpinInfo | null, now: number) {
  if (!spin) return { angle: pocketAngle(0), radius: POCKET_R, y: REST_Y };
  const p = Math.min(1, Math.max(0, (now - spin.startedAt) / spin.duration));
  const ease = 1 - Math.pow(1 - p, 3);
  const angle = pocketAngle(spin.result) - BALL_LAPS * Math.PI * 2 * (1 - ease);
  if (p < DROP_AT) return { angle, radius: TRACK_R, y: TRACK_Y };
  const q = (p - DROP_AT) / (1 - DROP_AT);
  const s = smooth(Math.min(1, q * 1.4));
  const bounce = Math.abs(Math.sin(q * Math.PI * 4)) * 0.12 * (1 - q) ** 2;
  return {
    angle,
    radius: TRACK_R + (POCKET_R - TRACK_R) * s,
    y: TRACK_Y + (REST_Y - TRACK_Y) * s + bounce,
  };
}

function Rotor({ spin }: { spin: SpinInfo | null }) {
  const rotor = useRef<THREE.Group>(null!);
  const ball = useRef<THREE.Mesh>(null!);
  const texture = useMemo(makeWheelTexture, []);
  const spinRef = useRef(spin);
  spinRef.current = spin;

  useFrame((_, dt) => {
    const s = spinRef.current;
    const now = serverNow();
    let speed = IDLE_SPEED;
    if (s) {
      const p = (now - s.startedAt) / s.duration;
      if (p >= 0 && p < 1) speed += 1.4 * (1 - p);
    }
    rotor.current.rotation.y += speed * Math.min(dt, 0.1);
    const { angle, radius, y } = ballPose(s, now);
    ball.current.position.set(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
  });

  const frets = useMemo(
    () =>
      WHEEL_ORDER.map((_, i) => {
        const a = i * STEP + STEP / 2;
        return { a, x: Math.cos(a) * POCKET_R, z: Math.sin(a) * POCKET_R };
      }),
    [],
  );

  return (
    <group ref={rotor}>
      {/* Rotor body */}
      <mesh position={[0, -0.13, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[R, R * 0.96, 0.26, 96]} />
        <meshStandardMaterial color={DARK_WOOD} roughness={0.6} />
      </mesh>
      {/* Printed face */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.002, 0]} receiveShadow>
        <circleGeometry args={[R, 128]} />
        <meshStandardMaterial map={texture} roughness={0.45} />
      </mesh>
      {/* Pocket walls */}
      {[POCKET_IN, POCKET_OUT].map((r) => (
        <mesh key={r} position={[0, 0.03, 0]}>
          <cylinderGeometry args={[r, r, 0.06, 128, 1, true]} />
          <meshStandardMaterial color={GOLD} metalness={0.7} roughness={0.3} side={THREE.DoubleSide} />
        </mesh>
      ))}
      {frets.map(({ a, x, z }, i) => (
        <mesh key={i} position={[x, 0.03, z]} rotation-y={-a} castShadow>
          <boxGeometry args={[POCKET_OUT - POCKET_IN, 0.06, 0.018]} />
          <meshStandardMaterial color={GOLD} metalness={0.7} roughness={0.3} />
        </mesh>
      ))}
      {/* Center cone + turret */}
      <mesh position={[0, 0.16, 0]} castShadow>
        <coneGeometry args={[POCKET_IN - 0.01, 0.32, 64]} />
        <meshStandardMaterial color={WOOD} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.45, 0]} castShadow>
        <cylinderGeometry args={[0.07, 0.12, 0.45, 24]} />
        <meshStandardMaterial color={GOLD} metalness={0.8} roughness={0.25} />
      </mesh>
      {[0, 1, 2, 3].map((i) => (
        <group key={i} rotation-y={(i * Math.PI) / 2} position={[0, 0.58, 0]}>
          <mesh position={[0.25, 0, 0]} rotation-z={Math.PI / 2}>
            <cylinderGeometry args={[0.025, 0.025, 0.5, 12]} />
            <meshStandardMaterial color={GOLD} metalness={0.8} roughness={0.25} />
          </mesh>
          <mesh position={[0.5, 0, 0]}>
            <sphereGeometry args={[0.055, 16, 16]} />
            <meshStandardMaterial color={GOLD} metalness={0.8} roughness={0.25} />
          </mesh>
        </group>
      ))}
      {/* Ball (lives in rotor space so it rides the wheel once it lands) */}
      <mesh ref={ball} castShadow>
        <sphereGeometry args={[BALL_R, 32, 32]} />
        <meshStandardMaterial color="#fbfbf7" roughness={0.15} metalness={0.1} />
      </mesh>
    </group>
  );
}

function Bowl() {
  const profile = useMemo(
    () =>
      [
        [R + 0.01, -0.28], [R + 0.01, 0.03], [2.3, 0.06], [2.45, 0.11], [2.6, 0.17],
        [2.72, 0.24], [2.78, 0.36], [2.95, 0.38], [3.05, 0.3], [3.05, -0.28],
      ].map(([x, y]) => new THREE.Vector2(x, y)),
    [],
  );
  return (
    <group>
      <mesh receiveShadow castShadow>
        <latheGeometry args={[profile, 128]} />
        <meshStandardMaterial color={WOOD} roughness={0.55} side={THREE.DoubleSide} />
      </mesh>
      {/* Deflectors */}
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2 + 0.2;
        return (
          <mesh key={i} position={[Math.cos(a) * 2.38, 0.12, Math.sin(a) * 2.38]} rotation-y={-a} scale={[1, 0.6, 2]}>
            <octahedronGeometry args={[0.05]} />
            <meshStandardMaterial color={GOLD} metalness={0.8} roughness={0.25} />
          </mesh>
        );
      })}
      {/* Felt under the wheel */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.28, 0]} receiveShadow>
        <circleGeometry args={[6, 64]} />
        <meshStandardMaterial color="#0c4a2a" roughness={1} />
      </mesh>
    </group>
  );
}

export default function Wheel3D({ spin }: { spin: SpinInfo | null }) {
  return (
    <Canvas shadows dpr={[1, 2]} camera={{ position: [0, 4.4, 4.2], fov: 42 }}>
      <color attach="background" args={['#06301b']} />
      <fog attach="fog" args={['#06301b', 8, 16]} />
      <ambientLight intensity={0.55} />
      <hemisphereLight args={['#fff6e0', '#0c4a2a', 0.5]} />
      <directionalLight
        position={[3, 8, 4]}
        intensity={2}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-4}
        shadow-camera-right={4}
        shadow-camera-top={4}
        shadow-camera-bottom={-4}
      />
      <pointLight position={[-3, 3, -2]} intensity={8} color="#ffd9a0" />
      <Bowl />
      <Rotor spin={spin} />
      <OrbitControls enablePan={false} minDistance={3.5} maxDistance={9} maxPolarAngle={Math.PI / 2.3} />
    </Canvas>
  );
}
