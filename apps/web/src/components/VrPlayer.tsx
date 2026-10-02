import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { VrMetadata } from '../lib/api';

interface Props {
  videoEl: HTMLVideoElement | null;
  vr: VrMetadata;
  onExit: () => void;
}

/**
 * 360° equirectangular / cubemap VR viewer.
 * Renders the playing <video> as a texture on the inside of a sphere.
 * Supports mouse drag, touch drag, keyboard, and device-orientation.
 */
export default function VrPlayer({ videoEl, vr, onExit }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<{
    renderer?: THREE.WebGLRenderer;
    scene?: THREE.Scene;
    camera?: THREE.PerspectiveCamera;
    mesh?: THREE.Mesh;
    texture?: THREE.VideoTexture;
    raf?: number;
    yaw: number;
    pitch: number;
    dragging: boolean;
    lastX: number;
    lastY: number;
    fov: number;
    autoRotate: boolean;
  }>({
    yaw: 0,
    pitch: 0,
    dragging: false,
    lastX: 0,
    lastY: 0,
    fov: vr.fov || 75,
    autoRotate: false,
  });

  const [showHint, setShowHint] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  const [fovLabel, setFovLabel] = useState(vr.fov || 75);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !videoEl) return;

    // ----- Setup -----
    const width = container.clientWidth || 800;
    const height = container.clientHeight || 450;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(vr.fov || 75, width / height, 0.1, 1100);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000, 1);
    container.appendChild(renderer.domElement);

    // ----- Video texture -----
    let texture: THREE.VideoTexture;
    let geometry: THREE.BufferGeometry;
    if (vr.projection === 'cubemap') {
      // Simple cubemap-ish: use a box geometry with video texture (approximation)
      geometry = new THREE.BoxGeometry(500, 500, 500);
      texture = new THREE.VideoTexture(videoEl);
      texture.colorSpace = THREE.SRGBColorSpace;
      const materials = new Array(6).fill(new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide }));
      const mesh = new THREE.Mesh(geometry, materials);
      scene.add(mesh);
      stateRef.current.mesh = mesh;
    } else {
      // Equirectangular: sphere with inside-facing material
      geometry = new THREE.SphereGeometry(500, 60, 40);
      geometry.scale(-1, 1, 1); // flip so we view from inside
      texture = new THREE.VideoTexture(videoEl);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      const material = new THREE.MeshBasicMaterial({ map: texture });
      const mesh = new THREE.Mesh(geometry, material);
      scene.add(mesh);
      stateRef.current.mesh = mesh;
    }

    // Initial view direction
    stateRef.current.yaw = THREE.MathUtils.degToRad(vr.initial_yaw || 0);
    stateRef.current.pitch = THREE.MathUtils.degToRad(vr.initial_pitch || 0);

    stateRef.current.renderer = renderer;
    stateRef.current.scene = scene;
    stateRef.current.camera = camera;
    stateRef.current.texture = texture;

    // ----- Helpers -----
    const updateCamera = () => {
      const s = stateRef.current;
      const yaw = s.yaw;
      const pitch = s.pitch;
      const target = new THREE.Vector3(
        Math.sin(yaw) * Math.cos(pitch),
        Math.sin(pitch),
        Math.cos(yaw) * Math.cos(pitch),
      );
      camera.lookAt(target.multiplyScalar(100));
      camera.fov = s.fov;
      camera.updateProjectionMatrix();
    };
    updateCamera();

    // ----- Mouse drag -----
    const onMouseDown = (e: MouseEvent) => {
      stateRef.current.dragging = true;
      stateRef.current.lastX = e.clientX;
      stateRef.current.lastY = e.clientY;
      stateRef.current.autoRotate = false;
      setAutoRotate(false);
    };
    const onMouseMove = (e: MouseEvent) => {
      const s = stateRef.current;
      if (!s.dragging) return;
      const dx = e.clientX - s.lastX;
      const dy = e.clientY - s.lastY;
      s.lastX = e.clientX;
      s.lastY = e.clientY;
      s.yaw -= dx * 0.005;
      s.pitch -= dy * 0.005;
      s.pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, s.pitch));
    };
    const onMouseUp = () => { stateRef.current.dragging = false; };

    renderer.domElement.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    // ----- Touch drag -----
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      stateRef.current.dragging = true;
      stateRef.current.lastX = e.touches[0].clientX;
      stateRef.current.lastY = e.touches[0].clientY;
      stateRef.current.autoRotate = false;
      setAutoRotate(false);
    };
    const onTouchMove = (e: TouchEvent) => {
      const s = stateRef.current;
      if (!s.dragging || e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - s.lastX;
      const dy = t.clientY - s.lastY;
      s.lastX = t.clientX;
      s.lastY = t.clientY;
      s.yaw -= dx * 0.008;
      s.pitch -= dy * 0.008;
      s.pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, s.pitch));
      e.preventDefault();
    };
    const onTouchEnd = () => { stateRef.current.dragging = false; };

    renderer.domElement.addEventListener('touchstart', onTouchStart, { passive: false });
    renderer.domElement.addEventListener('touchmove', onTouchMove, { passive: false });
    renderer.domElement.addEventListener('touchend', onTouchEnd);

    // ----- Keyboard -----
    const onKey = (e: KeyboardEvent) => {
      const s = stateRef.current;
      const step = 0.08;
      if (e.key === 'ArrowLeft') s.yaw += step;
      else if (e.key === 'ArrowRight') s.yaw -= step;
      else if (e.key === 'ArrowUp') s.pitch = Math.min(Math.PI / 2 - 0.05, s.pitch + step);
      else if (e.key === 'ArrowDown') s.pitch = Math.max(-Math.PI / 2 + 0.05, s.pitch - step);
      else if (e.key === '+' || e.key === '=') { s.fov = Math.max(30, s.fov - 5); setFovLabel(s.fov); }
      else if (e.key === '-' || e.key === '_') { s.fov = Math.min(120, s.fov + 5); setFovLabel(s.fov); }
      else if (e.key === 'r' || e.key === 'R') { s.yaw = THREE.MathUtils.degToRad(vr.initial_yaw || 0); s.pitch = THREE.MathUtils.degToRad(vr.initial_pitch || 0); }
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);

    // ----- Device orientation -----
    let deviceOrientationBound = false;
    const onOrientation = (e: DeviceOrientationEvent) => {
      if (e.alpha == null || e.beta == null || e.gamma == null) return;
      // Use alpha (yaw) as primary; beta/gamma add limited pitch
      stateRef.current.yaw = -THREE.MathUtils.degToRad(e.alpha);
      stateRef.current.pitch = THREE.MathUtils.degToRad(e.beta - 90) * 0.6;
      stateRef.current.autoRotate = false;
      setAutoRotate(false);
    };

    async function tryEnableOrientation() {
      try {
        const AnyDOE = (window as any).DeviceOrientationEvent;
        if (AnyDOE && typeof AnyDOE.requestPermission === 'function') {
          const r = await AnyDOE.requestPermission();
          if (r !== 'granted') return false;
        }
        window.addEventListener('deviceorientation', onOrientation);
        deviceOrientationBound = true;
        return true;
      } catch { return false; }
    }
    // Silently attempt (skip on desktop where no gyro)
    if (typeof (window as any).DeviceOrientationEvent !== 'undefined') {
      tryEnableOrientation();
    }

    // ----- Resize -----
    const onResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);

    // ----- Render loop -----
    const tick = () => {
      const s = stateRef.current;
      if (s.autoRotate) {
        s.yaw += 0.0025;
      }
      updateCamera();
      renderer.render(scene, camera);
      s.raf = requestAnimationFrame(tick);
    };
    tick();

    // Auto-hide hint
    const hintTimeout = window.setTimeout(() => setShowHint(false), 4000);

    // ----- Cleanup -----
    return () => {
      window.clearTimeout(hintTimeout);
      if (stateRef.current.raf) cancelAnimationFrame(stateRef.current.raf);
      renderer.domElement.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      renderer.domElement.removeEventListener('touchstart', onTouchStart);
      renderer.domElement.removeEventListener('touchmove', onTouchMove);
      renderer.domElement.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      if (deviceOrientationBound) {
        window.removeEventListener('deviceorientation', onOrientation);
      }
      try { texture.dispose(); } catch {}
      try { (geometry as any).dispose?.(); } catch {}
      try { renderer.dispose(); } catch {}
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [videoEl, vr.projection, vr.initial_yaw, vr.initial_pitch, vr.fov]);

  function toggleAutoRotate() {
    stateRef.current.autoRotate = !stateRef.current.autoRotate;
    setAutoRotate(stateRef.current.autoRotate);
  }

  function resetView() {
    stateRef.current.yaw = THREE.MathUtils.degToRad(vr.initial_yaw || 0);
    stateRef.current.pitch = THREE.MathUtils.degToRad(vr.initial_pitch || 0);
    stateRef.current.fov = vr.fov || 75;
    setFovLabel(stateRef.current.fov);
  }

  return (
    <div className="mf-vr-wrapper">
      <div ref={containerRef} className="mf-vr-canvas" />

      {/* Top controls */}
      <div className="mf-vr-controls">
        <button className="mf-vr-btn" onClick={toggleAutoRotate} title="Auto-rotate view">
          {autoRotate ? '⏸️' : '🔄'}
        </button>
        <button className="mf-vr-btn" onClick={resetView} title="Reset view">🎯</button>
        <span className="mf-vr-fov">FOV {Math.round(fovLabel)}°</span>
        <button className="mf-vr-btn mf-vr-exit" onClick={onExit} title="Exit VR mode">✕</button>
      </div>

      {/* Bottom info */}
      <div className="mf-vr-info">
        <span className="mf-vr-badge">🥽 {vr.projection === 'cubemap' ? 'Cubemap' : '360°'}</span>
        {vr.stereo !== 'mono' && <span className="mf-vr-badge">{vr.stereo === 'sbs' ? 'Side-by-Side' : 'Over-Under'}</span>}
        {vr.has_spatial_audio === 1 && <span className="mf-vr-badge">🎧 Spatial Audio</span>}
      </div>

      {/* Hint overlay */}
      {showHint && (
        <div className="mf-vr-hint" onClick={() => setShowHint(false)}>
          <div>🖱️ Drag to look around</div>
          <div>⌨️ Arrow keys · + / − for zoom · R to reset</div>
          <div>📱 Mobile: tilt device (or drag)</div>
        </div>
      )}
    </div>
  );
}
