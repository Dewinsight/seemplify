'use client'

import { useEffect, useRef } from 'react'
import * as THREE from 'three'

/**
 * Concentric rings that bloom outward and fade, drawn by a fragment shader.
 * Adapted from React Bits' MagicRings (MIT + Commons Clause): standalone
 * three.js, WebGL2 only, sleeps when off-screen or the tab is hidden.
 */

const vertexShader = /* glsl */ `
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const fragmentShader = /* glsl */ `
precision highp float;

uniform float uTime, uAttenuation, uLineThickness;
uniform float uBaseRadius, uRadiusStep, uScaleRate;
uniform float uOpacity, uNoiseAmount, uRotation, uRingGap;
uniform float uFadeIn, uFadeOut;
uniform float uMouseInfluence, uHoverAmount, uHoverScale, uParallax;
uniform float uCoverageAlpha;
uniform vec2 uResolution, uMouse;
uniform vec3 uColor, uColorTwo;
uniform int uRingCount;

const float HP = 1.5707963;
const float CYCLE = 3.45;

float fade(float t) {
  return t < uFadeIn ? smoothstep(0.0, uFadeIn, t) : 1.0 - smoothstep(uFadeOut, CYCLE - 0.2, t);
}

float ring(vec2 p, float ri, float cut, float t0, float px) {
  float t = mod(uTime + t0, CYCLE);
  float r = ri + t / CYCLE * uScaleRate;
  float d = abs(length(p) - r);
  float a = atan(abs(p.y), abs(p.x)) / HP;
  float th = max(1.0 - a, 0.5) * px * uLineThickness;
  float h = (1.0 - smoothstep(th, th * 1.5, d)) + 1.0;
  d += pow(cut * a, 3.0) * r;
  return h * exp(-uAttenuation * d) * fade(t);
}

void main() {
  float px = 1.0 / min(uResolution.x, uResolution.y);
  vec2 p = (gl_FragCoord.xy - 0.5 * uResolution.xy) * px;
  float cr = cos(uRotation), sr = sin(uRotation);
  p = mat2(cr, -sr, sr, cr) * p;
  p -= uMouse * uMouseInfluence;
  float sc = mix(1.0, uHoverScale, uHoverAmount);
  p /= sc;
  vec3 c = vec3(0.0);
  float coverage = 0.0;
  float rcf = max(float(uRingCount) - 1.0, 1.0);
  for (int i = 0; i < 10; i++) {
    if (i >= uRingCount) break;
    float fi = float(i);
    vec2 pr = p - fi * uParallax * uMouse;
    vec3 rc = mix(uColor, uColorTwo, fi / rcf);
    float ringAmount = ring(pr, uBaseRadius + fi * uRadiusStep, pow(uRingGap, fi), i == 0 ? 0.0 : 2.95 * fi, px);
    c = mix(c, rc, vec3(ringAmount));
    coverage = max(coverage, ringAmount);
  }
  float n = fract(sin(dot(gl_FragCoord.xy + uTime * 100.0, vec2(12.9898, 78.233))) * 43758.5453);
  c += (n - 0.5) * uNoiseAmount;
  float intensity = max(c.r, max(c.g, c.b));
  vec3 emissiveColor = intensity > 0.0001 ? clamp(c / intensity, 0.0, 1.0) : vec3(0.0);
  vec3 outputColor = mix(emissiveColor, clamp(c, 0.0, 1.0), uCoverageAlpha);
  float outputAlpha = mix(intensity, coverage, uCoverageAlpha);
  gl_FragColor = vec4(outputColor, clamp(outputAlpha * uOpacity, 0.0, 1.0));
}
`

interface MagicRingsProps {
  color?: string
  colorTwo?: string
  speed?: number
  ringCount?: number
  attenuation?: number
  lineThickness?: number
  baseRadius?: number
  radiusStep?: number
  scaleRate?: number
  opacity?: number
  noiseAmount?: number
  rotation?: number
  ringGap?: number
  fadeIn?: number
  fadeOut?: number
  mouseInfluence?: number
  hoverScale?: number
  parallax?: number
  /** "coverage" keeps the ring colours literal (good on light grounds); "luminance" glows additively. */
  alphaMode?: 'luminance' | 'coverage'
  className?: string
}

export default function MagicRings({
  color = '#7047eb',
  colorTwo = '#2ed3a0',
  speed = 0.8,
  ringCount = 6,
  attenuation = 10,
  lineThickness = 2,
  baseRadius = 0.35,
  radiusStep = 0.1,
  scaleRate = 0.1,
  opacity = 1,
  noiseAmount = 0.06,
  rotation = 0,
  ringGap = 1.5,
  fadeIn = 0.7,
  fadeOut = 0.5,
  mouseInfluence = 0.12,
  hoverScale = 1.1,
  parallax = 0.04,
  alphaMode = 'luminance',
  className,
}: MagicRingsProps) {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const propsRef = useRef<Required<Omit<MagicRingsProps, 'className'>> | null>(null)
  const mouseRef = useRef([0, 0])
  const smoothMouseRef = useRef([0, 0])
  const hoverAmountRef = useRef(0)
  const isHoveredRef = useRef(false)

  propsRef.current = {
    color, colorTwo, speed, ringCount, attenuation, lineThickness, baseRadius, radiusStep, scaleRate, opacity,
    noiseAmount, rotation, ringGap, fadeIn, fadeOut, mouseInfluence, hoverScale, parallax, alphaMode,
  }

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true })
    } catch {
      return
    }
    if (!renderer.capabilities.isWebGL2) {
      renderer.dispose()
      return
    }

    renderer.setClearColor(0x000000, 0)
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.1, 10)
    camera.position.z = 1

    const uniforms = {
      uTime: { value: 0 },
      uAttenuation: { value: 0 },
      uResolution: { value: new THREE.Vector2() },
      uColor: { value: new THREE.Color() },
      uColorTwo: { value: new THREE.Color() },
      uLineThickness: { value: 0 },
      uBaseRadius: { value: 0 },
      uRadiusStep: { value: 0 },
      uScaleRate: { value: 0 },
      uRingCount: { value: 0 },
      uOpacity: { value: 1 },
      uNoiseAmount: { value: 0 },
      uRotation: { value: 0 },
      uRingGap: { value: 1.6 },
      uFadeIn: { value: 0.5 },
      uFadeOut: { value: 0.75 },
      uMouse: { value: new THREE.Vector2() },
      uMouseInfluence: { value: 0 },
      uHoverAmount: { value: 0 },
      uHoverScale: { value: 1 },
      uParallax: { value: 0 },
      uCoverageAlpha: { value: 0 },
    }

    const material = new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms, transparent: true })
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material)
    scene.add(quad)

    const resize = () => {
      const w = mount.clientWidth
      const h = mount.clientHeight
      const dpr = Math.min(window.devicePixelRatio, 2)
      renderer.setSize(w, h)
      renderer.setPixelRatio(dpr)
      uniforms.uResolution.value.set(w * dpr, h * dpr)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(mount)

    const parent = mount.parentElement ?? mount
    const onMouseMove = (e: MouseEvent) => {
      const rect = mount.getBoundingClientRect()
      mouseRef.current[0] = (e.clientX - rect.left) / rect.width - 0.5
      mouseRef.current[1] = -((e.clientY - rect.top) / rect.height - 0.5)
    }
    const onMouseEnter = () => {
      isHoveredRef.current = true
    }
    const onMouseLeave = () => {
      isHoveredRef.current = false
      mouseRef.current[0] = 0
      mouseRef.current[1] = 0
    }
    parent.addEventListener('mousemove', onMouseMove)
    parent.addEventListener('mouseenter', onMouseEnter)
    parent.addEventListener('mouseleave', onMouseLeave)

    let frameId = 0
    let isVisible = false
    let isPageVisible = !document.hidden
    let elapsed = 0
    let lastT = 0
    const animate = (t: number) => {
      frameId = requestAnimationFrame(animate)
      const p = propsRef.current!
      const dt = lastT === 0 ? 0 : Math.min(t - lastT, 100)
      lastT = t
      elapsed += dt * 0.001 * p.speed

      smoothMouseRef.current[0] += (mouseRef.current[0] - smoothMouseRef.current[0]) * 0.08
      smoothMouseRef.current[1] += (mouseRef.current[1] - smoothMouseRef.current[1]) * 0.08
      hoverAmountRef.current += ((isHoveredRef.current ? 1 : 0) - hoverAmountRef.current) * 0.08

      uniforms.uTime.value = elapsed
      uniforms.uAttenuation.value = p.attenuation
      uniforms.uColor.value.set(p.color)
      uniforms.uColorTwo.value.set(p.colorTwo)
      uniforms.uLineThickness.value = p.lineThickness
      uniforms.uBaseRadius.value = p.baseRadius
      uniforms.uRadiusStep.value = p.radiusStep
      uniforms.uScaleRate.value = p.scaleRate
      uniforms.uRingCount.value = p.ringCount
      uniforms.uOpacity.value = p.opacity
      uniforms.uNoiseAmount.value = p.noiseAmount
      uniforms.uRotation.value = (p.rotation * Math.PI) / 180
      uniforms.uRingGap.value = p.ringGap
      uniforms.uFadeIn.value = p.fadeIn
      uniforms.uFadeOut.value = p.fadeOut
      uniforms.uMouse.value.set(smoothMouseRef.current[0], smoothMouseRef.current[1])
      uniforms.uMouseInfluence.value = p.mouseInfluence
      uniforms.uHoverAmount.value = hoverAmountRef.current
      uniforms.uHoverScale.value = p.hoverScale
      uniforms.uParallax.value = p.parallax
      uniforms.uCoverageAlpha.value = p.alphaMode === 'coverage' ? 1 : 0

      renderer.render(scene, camera)
    }

    const tryStart = () => {
      if (isVisible && isPageVisible && frameId === 0) {
        lastT = 0
        frameId = requestAnimationFrame(animate)
      }
    }
    const tryStop = () => {
      if (frameId !== 0) {
        cancelAnimationFrame(frameId)
        frameId = 0
      }
    }

    const io = new IntersectionObserver(
      ([entry]) => {
        isVisible = entry.isIntersecting
        if (isVisible) tryStart()
        else tryStop()
      },
      { threshold: 0 },
    )
    io.observe(mount)

    const onVisibility = () => {
      isPageVisible = !document.hidden
      if (isPageVisible) tryStart()
      else tryStop()
    }
    document.addEventListener('visibilitychange', onVisibility)
    tryStart()

    return () => {
      tryStop()
      io.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      ro.disconnect()
      parent.removeEventListener('mousemove', onMouseMove)
      parent.removeEventListener('mouseenter', onMouseEnter)
      parent.removeEventListener('mouseleave', onMouseLeave)
      mount.removeChild(renderer.domElement)
      renderer.dispose()
      material.dispose()
      quad.geometry.dispose()
    }
  }, [])

  return <div ref={mountRef} className={className} style={{ width: '100%', height: '100%' }} aria-hidden="true" />
}
