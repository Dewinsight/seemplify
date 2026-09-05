'use client'

import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

/**
 * Flowing-silk shader plane, adapted from React Bits' "Silk" background
 * (MIT + Commons Clause) so it renders inside an existing R3F canvas behind
 * the scene instead of spinning up a second WebGL context.
 */

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const fragmentShader = /* glsl */ `
varying vec2 vUv;
uniform float uTime;
uniform vec3  uColor;
uniform float uSpeed;
uniform float uScale;
uniform float uRotation;
uniform float uNoiseIntensity;
uniform float uLightMode;
uniform float uOpacity;

const float e = 2.71828182845904523536;

float noise(vec2 texCoord) {
  float G = e;
  vec2  r = (G * sin(G * texCoord));
  return fract(r.x * r.y * (1.0 + texCoord.x));
}

vec2 rotateUvs(vec2 uv, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  mat2  rot = mat2(c, -s, s, c);
  return rot * uv;
}

void main() {
  float rnd     = noise(gl_FragCoord.xy);
  vec2  uv      = rotateUvs(vUv * uScale, uRotation);
  vec2  tex     = uv * uScale;
  float tOffset = uSpeed * uTime;

  tex.y += 0.03 * sin(8.0 * tex.x - tOffset);

  float pattern = 0.6 +
                  0.4 * sin(5.0 * (tex.x + tex.y +
                                   cos(3.0 * tex.x + 5.0 * tex.y) +
                                   0.02 * tOffset) +
                           sin(20.0 * (tex.x + tex.y - 0.1 * tOffset)));

  float grain = rnd / 15.0 * uNoiseIntensity;
  vec3 result = uColor * pattern - vec3(grain);
  if (uLightMode > 0.5) {
    float fold = smoothstep(0.28, 0.9, pattern);
    float specular = smoothstep(0.72, 0.98, pattern);
    vec3 shadowColor = uColor * 0.72;
    vec3 bodyColor = min(uColor * 1.18, vec3(1.0));
    vec3 lightBase = mix(shadowColor, bodyColor, fold);
    lightBase = mix(lightBase, vec3(1.0), specular * 0.92);
    float fineNoise = noise(gl_FragCoord.xy * 0.63 + vec2(17.0, 41.0));
    float grainSignal = (rnd + fineNoise - 1.0);
    float grainStrength = clamp(uNoiseIntensity * 0.038, 0.0, 0.16);
    result = lightBase + grainSignal * grainStrength;
  }
  gl_FragColor = vec4(clamp(result, 0.0, 1.0), uOpacity);
}
`

interface SilkPlaneProps {
  color: string
  lightMode?: boolean
  speed?: number
  scale?: number
  rotation?: number
  noiseIntensity?: number
  opacity?: number
  /** Distance behind the origin, along -z. */
  depth?: number
}

export default function SilkPlane({
  color,
  lightMode = false,
  speed = 3,
  scale = 1,
  rotation = 0.35,
  noiseIntensity = 1.2,
  opacity = 1,
  depth = 8,
}: SilkPlaneProps) {
  const mesh = useRef<THREE.Mesh>(null)
  const camera = useThree((state) => state.camera)
  const viewport = useThree((state) => state.viewport)

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(color) },
      uSpeed: { value: speed },
      uScale: { value: scale },
      uRotation: { value: rotation },
      uNoiseIntensity: { value: noiseIntensity },
      uLightMode: { value: lightMode ? 1 : 0 },
      uOpacity: { value: opacity },
    }),
    // Created once; live updates go through the effect-free assignments in useFrame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  // Size the plane to fill the camera's view at its depth, whatever the frame's aspect.
  const size = useMemo(() => {
    const view = viewport.getCurrentViewport(camera, [0, 0, -depth])
    return [view.width * 1.15, view.height * 1.15] as const
  }, [camera, viewport, depth])

  useFrame((_, delta) => {
    uniforms.uTime.value += 0.1 * delta
    uniforms.uColor.value.set(color)
    uniforms.uSpeed.value = speed
    uniforms.uLightMode.value = lightMode ? 1 : 0
    uniforms.uOpacity.value = opacity
  })

  return (
    <mesh ref={mesh} position={[0, 0, -depth]} scale={[size[0], size[1], 1]}>
      <planeGeometry args={[1, 1, 1, 1]} />
      <shaderMaterial uniforms={uniforms} vertexShader={vertexShader} fragmentShader={fragmentShader} transparent={opacity < 1} depthWrite={false} />
    </mesh>
  )
}
