// The gallery: one long painted wall you swipe along, in the same impasto look as the studio.
// Pictures hang in wooden frames at eye level; drag, wheel or arrow keys move the camera, and it
// settles in front of the nearest picture. A first version: the hang is a single row.
// Types: galleryScene.d.ts.
import * as THREE from 'three';
import { rng, loadImage, strokes, alphaBounds, radial, lerp } from './studioScene';

const GAP = 2.15;        // between picture centres
const EYE = 1.55;        // height of a picture's centre
const BOX = 1.3;         // a picture fits a square this size

export function createGalleryScene(canvas, { base, items, onIndex, reducedMotion = false }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#e8d6b8');
  scene.fog = new THREE.Fog('#efe2cc', 9, 22);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 60);
  const disposables = [];
  let disposed = false;
  const keep = (x) => {
    if (disposed) x.dispose?.();
    else disposables.push(x);
    return x;
  };
  const R = rng(5);
  const n = items.length, span = Math.max(0, n - 1) * GAP;

  // wall, floor and skirting, painted in code
  const plaster = keep(strokes(512, 512, (g, w, h, r) => {
    g.fillStyle = '#efe4d2'; g.fillRect(0, 0, w, h);
    const cols = ['#f7efe2', '#e6dcef', '#d9e2f1', '#f3e4c8', '#eadfce', '#fbf7ef', '#e4d9ec'];
    for (let i = 0; i < 70; i++) {
      g.fillStyle = cols[i % cols.length]; g.globalAlpha = 0.5 + r() * 0.5;
      g.beginPath(); g.ellipse(r() * w, r() * h, 30 + r() * 70, 18 + r() * 40, r() * 3, 0, 7); g.fill();
    }
    g.globalAlpha = 1;
  }, { len: [12, 28], width: [7, 13], vary: 0.06, seed: 2 }));
  plaster.wrapS = plaster.wrapT = THREE.RepeatWrapping;
  const wallW = span + 14;
  plaster.repeat.set(wallW / 1.7, 2.7);
  const wall = new THREE.Mesh(keep(new THREE.PlaneGeometry(wallW, 4.6)), keep(new THREE.MeshBasicMaterial({ map: plaster })));
  wall.position.set(span / 2, 2.3, 0); scene.add(wall);
  const boards = keep(strokes(512, 512, (g, w, h, r) => {
    g.fillStyle = '#c08552'; g.fillRect(0, 0, w, h);
    g.globalAlpha = 0.55;
    for (let i = 0; i < 90; i++) {
      g.fillStyle = ['#cf9560', '#a86f42', '#e0b37e', '#9aa8c8', '#b47a48'][i % 5];
      g.beginPath(); g.ellipse(r() * w, r() * h, 30 + r() * 60, 10 + r() * 16, 0, 0, 7); g.fill();
    }
    g.globalAlpha = 1;
  }, { len: [24, 50], width: [10, 18], angle: 0, jitter: 0.3, seed: 21 }));
  boards.wrapS = boards.wrapT = THREE.RepeatWrapping; boards.repeat.set(wallW / 3, 3);
  const floor = new THREE.Mesh(keep(new THREE.PlaneGeometry(wallW, 9)), keep(new THREE.MeshBasicMaterial({ map: boards })));
  floor.rotation.x = -Math.PI / 2; floor.position.set(span / 2, 0, 4.5); scene.add(floor);
  const wood = keep(strokes(256, 256, (g, w, h, r) => {
    g.fillStyle = '#b9733a'; g.fillRect(0, 0, w, h);
    g.globalAlpha = 0.6;
    for (let i = 0; i < 40; i++) {
      g.fillStyle = ['#cf8a45', '#a35e2a', '#e0a35c', '#8c4d22', '#e6b574'][i % 5];
      g.beginPath(); g.ellipse(r() * w, r() * h, 20 + r() * 40, 8 + r() * 10, 0, 0, 7); g.fill();
    }
    g.globalAlpha = 1;
  }, { len: [24, 50], width: [6, 12], angle: 0, jitter: 0.2, seed: 4 }));
  const woodMat = keep(new THREE.MeshBasicMaterial({ map: wood }));
  const skirting = new THREE.Mesh(keep(new THREE.BoxGeometry(wallW, 0.16, 0.05)), woodMat);
  skirting.position.set(span / 2, 0.08, 0.03); scene.add(skirting);

  // frames: a soft shadow on the wall, the wooden frame, a cream mount, the picture
  const shadowTex = keep(radial('rgba(70,40,20,.5)', 'rgba(70,40,20,0)'));
  const shadowMat = keep(new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
  const mountMat = keep(new THREE.MeshBasicMaterial({ color: 0xf6efe2 }));
  const unit = keep(new THREE.PlaneGeometry(1, 1));
  const frames = items.map((item, i) => {
    const g = new THREE.Group();
    g.position.set(i * GAP, EYE, 0.02);
    const sh = new THREE.Mesh(unit, shadowMat); g.add(sh);
    const frame = new THREE.Mesh(keep(new THREE.BoxGeometry(1, 1, 0.07)), woodMat); g.add(frame);
    const mount = new THREE.Mesh(unit, mountMat); mount.position.z = 0.037; g.add(mount);
    const pic = new THREE.Mesh(unit, keep(new THREE.MeshBasicMaterial({ color: 0xf1e8d8 }))); pic.position.z = 0.04; g.add(pic);
    const size = (aspect) => {
      const w = aspect >= 1 ? BOX : BOX * aspect, h = aspect >= 1 ? BOX / aspect : BOX;
      pic.scale.set(w, h, 1);
      mount.scale.set(w + 0.1, h + 0.1, 1);
      frame.scale.set(w + 0.24, h + 0.24, 1);
      sh.scale.set(w + 0.9, h + 0.9, 1); sh.position.set(0.06, -0.1, -0.01);
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

  // painted props from the studio: ivy beams overhead, a plant now and then
  async function props() {
    const cut = async (path, height) => {
      const im = await loadImage(base + path);
      const t = keep(new THREE.Texture(im)); t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true;
      const b = alphaBounds(im), w = height * (((b.u1 - b.u0) * im.width) / ((b.v1 - b.v0) * im.height));
      const geo = keep(new THREE.PlaneGeometry(w, height).translate(0, height / 2, 0));
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, lerp(b.u0, b.u1, uv.getX(i)), lerp(b.v0, b.v1, uv.getY(i)));
      return { geo, mat: keep(new THREE.MeshBasicMaterial({ map: t, transparent: true, alphaTest: 0.42 })), w };
    };
    const beam = await cut('beam-vines.webp', 0.95), plant = await cut('plant.webp', 0.95);
    if (disposed) return;
    for (let x = -3; x < span + 4; x += beam.w * 0.96) {
      const m = new THREE.Mesh(beam.geo, beam.mat);
      m.position.set(x, 2.75, 0.12); m.scale.x = R() < 0.5 ? 1 : -1; scene.add(m); swaying.push(m);
    }
    for (let i = 1; i < n; i += 3) {
      const m = new THREE.Mesh(plant.geo, plant.mat);
      m.position.set((i - 0.5) * GAP, 0, 0.3); scene.add(m); swaying.push(m);
    }
  }
  const swaying = [];
  props().catch((err) => console.error('gallery scene', err));

  // dust in the light
  const DUST = 140, dustSeed = [], dustPos = new Float32Array(DUST * 3);
  for (let i = 0; i < DUST; i++) dustSeed.push([-3 + R() * (span + 6), 0.4 + R() * 2.6, 0.3 + R() * 2.4, R() * 6.3, 0.5 + R()]);
  const dust = new THREE.Points(keep(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(dustPos, 3))),
    keep(new THREE.PointsMaterial({ map: keep(radial('rgba(255,255,255,1)', 'rgba(255,255,255,0)')), color: 0xfff1c8, size: 0.03, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending })));
  scene.add(dust);

  // ---- moving along the wall ----
  let W = 1, H = 1, dist = 4;
  let x = 0, goal = 0, vel = 0, index = 0, dragging = false, lastX = 0, lastT = 0;
  const clampGoal = (v) => Math.min(span + 0.35, Math.max(-0.35, v));
  const settle = (v) => Math.min(n - 1, Math.max(0, Math.round(v / GAP)));
  function resize() {
    W = Math.max(1, canvas.clientWidth); H = Math.max(1, canvas.clientHeight);
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    const half = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    // a phone shows one picture; a wide screen steps back only as far as the picture's height asks
    dist = Math.max((BOX / 2 + 0.34) / (half * camera.aspect), (BOX / 2 + 1.05) / half);
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();
  const perPx = () => (2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect) / W;

  const onDown = (e) => {
    dragging = true; lastX = e.clientX; lastT = performance.now(); vel = 0;
    canvas.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e) => {
    if (!dragging) return;
    const now = performance.now(), dx = (e.clientX - lastX) * perPx();
    goal = clampGoal(goal - dx);
    vel = -dx / Math.max(1, now - lastT) * 1000;
    lastX = e.clientX; lastT = now;
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
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
    if (e.key === 'ArrowRight') goal = settle(goal / GAP + 1) * GAP;
    else if (e.key === 'ArrowLeft') goal = settle(goal / GAP - 1) * GAP;
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
    const speed = (x - before) / dt;
    const near = settle(x);
    if (near !== index) { index = near; onIndex?.(index); }
    // the picture in front comes a little off the wall
    frames.forEach((f, i) => {
      const k = Math.max(0, 1 - Math.abs(i * GAP - x) / GAP);
      f.position.z = 0.02 + k * 0.06; f.scale.setScalar(1 + k * 0.05);
    });
    const sway = reducedMotion ? 0 : 1;
    for (const [i, m] of swaying.entries()) m.rotation.z = Math.sin(now * 0.6 + i) * 0.012 * sway;
    for (let i = 0; i < DUST; i++) {
      const [dx, dy, dz, ph, sp] = dustSeed[i];
      dustPos[i * 3] = dx + Math.sin(now * 0.2 * sp + ph) * 0.15;
      dustPos[i * 3 + 1] = 0.3 + ((dy + now * 0.04 * sp * sway) % 2.8);
      dustPos[i * 3 + 2] = dz + Math.cos(now * 0.17 * sp + ph) * 0.12;
    }
    dust.geometry.attributes.position.needsUpdate = true;
    // the camera leans into the direction of travel
    const lean = THREE.MathUtils.clamp(speed * 0.06, -0.5, 0.5);
    camera.position.set(x - lean * 0.4, EYE + 0.02 + Math.sin(now * 0.4) * 0.01 * sway, dist);
    camera.lookAt(x + lean, EYE - 0.02, 0);
    renderer.render(scene, camera);
  }
  const onVisible = () => renderer.setAnimationLoop(document.hidden || disposed ? null : loop);
  document.addEventListener('visibilitychange', onVisible);
  onVisible();

  return {
    go(i) { goal = settle(i) * GAP; },
    step(d) { goal = settle(goal / GAP + d) * GAP; },
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
