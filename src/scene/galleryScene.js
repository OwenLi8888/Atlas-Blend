// The gallery: one long white wall you walk along by swiping. The room itself has no colour (white
// wall, grey floor, black frames, white mounts), so the only colour is in the paintings. Each part
// of the hang starts with its name lettered on the wall. Drag, wheel or arrow keys move the camera,
// and it settles in front of the nearest picture; a tap on that picture asks to read about it.
// Types: galleryScene.d.ts.
import * as THREE from 'three';
import { loadImage, strokes, radial } from './studioScene';

const GAP = 2.15;        // between picture centres
const EYE = 1.55;        // height of a picture's centre
const BOX = 1.3;         // a picture fits a square this size
const INK = 0x111111;

export function createGalleryScene(canvas, { items, sections = [], onIndex, onTap, reducedMotion = false }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#f1f1ef');
  scene.fog = new THREE.Fog('#f1f1ef', 9, 22);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 60);
  const disposables = [];
  let disposed = false;
  const keep = (x) => {
    if (disposed) x.dispose?.();
    else disposables.push(x);
    return x;
  };
  const n = items.length, span = Math.max(0, n - 1) * GAP;

  // wall, floor and skirting, brushed in greys
  const plaster = keep(strokes(512, 512, (g, w, h, r) => {
    g.fillStyle = '#ebebe9'; g.fillRect(0, 0, w, h);
    const cols = ['#f2f2f0', '#e6e6e4', '#eeeeec', '#e9e9e7'];
    for (let i = 0; i < 60; i++) {
      g.fillStyle = cols[i % cols.length]; g.globalAlpha = 0.5 + r() * 0.5;
      g.beginPath(); g.ellipse(r() * w, r() * h, 30 + r() * 70, 18 + r() * 40, r() * 3, 0, 7); g.fill();
    }
    g.globalAlpha = 1;
  }, { len: [12, 28], width: [7, 13], vary: 0.02, seed: 2 }));
  plaster.wrapS = plaster.wrapT = THREE.RepeatWrapping;
  const wallW = span + 14;
  plaster.repeat.set(wallW / 1.7, 2.7);
  const wall = new THREE.Mesh(keep(new THREE.PlaneGeometry(wallW, 4.6)), keep(new THREE.MeshBasicMaterial({ map: plaster })));
  wall.position.set(span / 2, 2.3, 0); scene.add(wall);
  const boards = keep(strokes(512, 512, (g, w, h, r) => {
    g.fillStyle = '#cfcfcc'; g.fillRect(0, 0, w, h);
    g.globalAlpha = 0.55;
    for (let i = 0; i < 90; i++) {
      g.fillStyle = ['#d8d8d5', '#c2c2bf', '#dededb', '#b9b9b6', '#c9c9c6'][i % 5];
      g.beginPath(); g.ellipse(r() * w, r() * h, 30 + r() * 60, 10 + r() * 16, 0, 0, 7); g.fill();
    }
    g.globalAlpha = 1;
  }, { len: [24, 50], width: [10, 18], angle: 0, jitter: 0.3, vary: 0.02, seed: 21 }));
  boards.wrapS = boards.wrapT = THREE.RepeatWrapping; boards.repeat.set(wallW / 3, 3);
  const floor = new THREE.Mesh(keep(new THREE.PlaneGeometry(wallW, 9)), keep(new THREE.MeshBasicMaterial({ map: boards })));
  floor.rotation.x = -Math.PI / 2; floor.position.set(span / 2, 0, 4.5); scene.add(floor);
  const skirting = new THREE.Mesh(keep(new THREE.BoxGeometry(wallW, 0.14, 0.04)), keep(new THREE.MeshBasicMaterial({ color: 0xfafaf9 })));
  skirting.position.set(span / 2, 0.07, 0.02); scene.add(skirting);

  // each picture: a pool of light on the wall, a soft shadow, a thin black frame, a white mount, the picture
  const inkMat = keep(new THREE.MeshBasicMaterial({ color: INK }));
  const lightMat = keep(new THREE.MeshBasicMaterial({ map: keep(radial('rgba(255,255,255,.95)', 'rgba(255,255,255,0)')), transparent: true, depthWrite: false }));
  const shadowMat = keep(new THREE.MeshBasicMaterial({ map: keep(radial('rgba(0,0,0,.34)', 'rgba(0,0,0,0)')), transparent: true, depthWrite: false }));
  const mountMat = keep(new THREE.MeshBasicMaterial({ color: 0xffffff }));
  const unit = keep(new THREE.PlaneGeometry(1, 1));
  const box = keep(new THREE.BoxGeometry(1, 1, 0.05));
  const frames = items.map((item, i) => {
    const g = new THREE.Group();
    g.position.set(i * GAP, EYE, 0.02);
    const light = new THREE.Mesh(unit, lightMat); light.position.z = -0.012; light.scale.set(3.4, 3.4, 1); g.add(light);
    const sh = new THREE.Mesh(unit, shadowMat); g.add(sh);
    const frame = new THREE.Mesh(box, inkMat); g.add(frame);
    const mount = new THREE.Mesh(unit, mountMat); mount.position.z = 0.027; g.add(mount);
    const pic = new THREE.Mesh(unit, keep(new THREE.MeshBasicMaterial({ color: 0xe9e9e7 }))); pic.position.z = 0.03; g.add(pic);
    const size = (aspect) => {
      const w = aspect >= 1 ? BOX : BOX * aspect, h = aspect >= 1 ? BOX / aspect : BOX;
      pic.scale.set(w, h, 1);
      mount.scale.set(w + 0.26, h + 0.26, 1);
      frame.scale.set(w + 0.32, h + 0.32, 1);
      sh.scale.set(w + 0.95, h + 0.95, 1); sh.position.set(0.05, -0.1, -0.01);
    };
    size(item.aspect ?? 1);
    scene.add(g);
    loadImage(item.src).then((im) => {
      if (disposed) return;
      const t = keep(new THREE.Texture(im)); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.needsUpdate = true;
      pic.material.map = t; pic.material.color.set(0xffffff); pic.material.needsUpdate = true;
      size(im.width / im.height);
    }).catch(() => {});
    return g;
  });

  // the name of each part of the hang, lettered on the wall above its first picture, and a hairline before it
  const serif = getComputedStyle(document.documentElement).getPropertyValue('--serif') || 'Georgia, serif';
  const labels = [];
  function letter(text) {
    const cv = document.createElement('canvas'), px = 120;
    const g = cv.getContext('2d');
    g.font = `400 ${px}px ${serif}`;
    cv.width = Math.ceil(g.measureText(text).width) + 16; cv.height = Math.round(px * 1.3);
    g.font = `400 ${px}px ${serif}`;
    g.fillStyle = '#111'; g.textBaseline = 'middle';
    g.fillText(text, 8, cv.height / 2);
    const t = keep(new THREE.CanvasTexture(cv)); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    const h = 0.2, w = h * (cv.width / cv.height);
    const m = new THREE.Mesh(keep(new THREE.PlaneGeometry(w, h).translate(w / 2, 0, 0)), keep(new THREE.MeshBasicMaterial({ map: t, transparent: true })));
    return m;
  }
  (document.fonts?.ready ?? Promise.resolve()).then(() => {
    if (disposed) return;
    for (const s of sections) {
      const m = letter(s.title);
      m.position.set(s.at * GAP - BOX / 2 - 0.16, EYE + BOX / 2 + 0.46, 0.012);
      scene.add(m); labels.push(m);
      if (s.at > 0) {
        const line = new THREE.Mesh(unit, inkMat);
        line.scale.set(0.008, 1.9, 1); line.position.set((s.at - 0.5) * GAP, EYE + 0.05, 0.012);
        scene.add(line);
      }
    }
  });

  // ---- moving along the wall ----
  let W = 1, H = 1, dist = 4;
  let x = 0, goal = 0, vel = 0, index = 0, dragging = false, lastX = 0, lastT = 0;
  let downX = 0, downY = 0, downT = 0, moved = 0;
  let close = 0, closeGoal = 0;   // 1 while a picture is being read about: the camera comes in
  const clampGoal = (v) => Math.min(span + 0.35, Math.max(-0.35, v));
  /** The picture nearest to wall position `v`. */
  const settle = (v) => Math.min(n - 1, Math.max(0, Math.round(v / GAP)));
  /** The wall position of picture `i`, kept inside the hang. */
  const at = (i) => Math.min(n - 1, Math.max(0, i)) * GAP;
  function resize() {
    W = Math.max(1, canvas.clientWidth); H = Math.max(1, canvas.clientHeight);
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    const half = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    // a phone shows one picture; a wide screen steps back only as far as the picture's height asks
    dist = Math.max((BOX / 2 + 0.4) / (half * camera.aspect), (BOX / 2 + 1.05) / half);
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();
  const perPx = () => (2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect) / W;

  const onDown = (e) => {
    dragging = true; lastX = e.clientX; lastT = performance.now(); vel = 0;
    downX = e.clientX; downY = e.clientY; downT = lastT; moved = 0;
    canvas.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e) => {
    if (!dragging) return;
    const now = performance.now(), dx = (e.clientX - lastX) * perPx();
    moved = Math.max(moved, Math.hypot(e.clientX - downX, e.clientY - downY));
    goal = clampGoal(goal - dx);
    vel = -dx / Math.max(1, now - lastT) * 1000;
    lastX = e.clientX; lastT = now;
  };
  const onUp = (e) => {
    if (!dragging) return;
    dragging = false;
    if (e.type === 'pointerup' && moved < 8 && performance.now() - downT < 450) {
      // a tap: on the picture in front, read about it; on a neighbour, walk to it
      const r = canvas.getBoundingClientRect();
      const tapped = settle(x + (e.clientX - r.left - W / 2) * perPx());
      goal = tapped * GAP;
      if (tapped === index) onTap?.(index);
      return;
    }
    // a flick carries on to the next picture, never further: one swipe, one step
    const here = settle(x), flick = Math.abs(vel) > 0.6 ? Math.sign(vel) : 0;
    goal = Math.min(here + 1, Math.max(here - 1, settle(goal) + (settle(goal) === here ? flick : 0))) * GAP;
  };
  let wheelTimer = 0;
  const onWheel = (e) => {
    e.preventDefault();
    goal = clampGoal(goal + (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * perPx() * 0.9);
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => { goal = settle(goal) * GAP; }, 140);
  };
  const onKey = (e) => {
    if (e.key === 'ArrowRight') goal = at(settle(goal) + 1);
    else if (e.key === 'ArrowLeft') goal = at(settle(goal) - 1);
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKey);

  let last = 0;
  function loop() {
    const now = performance.now() / 1000, dt = Math.min(0.05, last ? now - last : 0.016);
    last = now;
    const before = x;
    x += (goal - x) * (1 - Math.exp(-dt * (dragging ? 18 : 6)));
    close += (closeGoal - close) * (1 - Math.exp(-dt * 5));
    const speed = (x - before) / dt;
    const near = settle(x);
    if (near !== index) { index = near; onIndex?.(index); }
    // the picture in front comes a little off the wall
    frames.forEach((f, i) => {
      const k = Math.max(0, 1 - Math.abs(i * GAP - x) / GAP);
      f.position.z = 0.02 + k * 0.06; f.scale.setScalar(1 + k * 0.05);
    });
    // the lettering steps aside while a picture is read about (the camera would push it under the page's title)
    for (const m of labels) m.material.opacity = 1 - close;
    // the camera leans into the direction of travel; reading about a picture brings it in and lifts the picture up the screen
    const sway = reducedMotion ? 0 : 1;
    const lean = THREE.MathUtils.clamp(speed * 0.06, -0.5, 0.5);
    camera.position.set(x - lean * 0.4, EYE + 0.02 - close * 0.3 + Math.sin(now * 0.4) * 0.01 * sway, dist * (1 - close * 0.16));
    camera.lookAt(x + lean, EYE - 0.02 - close * 0.3, 0);
    renderer.render(scene, camera);
  }
  const onVisible = () => renderer.setAnimationLoop(document.hidden || disposed ? null : loop);
  document.addEventListener('visibilitychange', onVisible);
  onVisible();

  return {
    go(i) { goal = at(i); },
    step(d) { goal = at(settle(goal) + d); },
    focus(on) { closeGoal = on ? 1 : 0; },
    dispose() {
      disposed = true;
      renderer.setAnimationLoop(null);
      ro.disconnect();
      clearTimeout(wheelTimer);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVisible);
      for (const d of disposables) d.dispose?.();
      renderer.dispose();
    },
  };
}
