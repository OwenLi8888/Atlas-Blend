// The painter's studio behind the first screen: a painted 2.5D diorama in three.js.
//
// Every piece is a painted cutout (public/studio/*.webp) standing on a plane at its own depth, so
// camera motion gives real parallax. On load the camera comes down from the far upper corner while
// the room unfolds like a pop-up book, then the painters are painted onto the palette stroke by
// stroke. After that they breathe, wave, blink and hop; birds cross the windows; dust drifts in the
// sun. Tapping a painter calls onPick(id). Types: studioScene.d.ts.
import * as THREE from 'three';

const lerp = (a, b, k) => a + (b - a) * k;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const seg = (t, a, d) => clamp01((t - a) / d);
const io = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const out = (k) => 1 - Math.pow(1 - k, 3);
/** Lands past the target and settles back: the pop-up "snap". */
const spring = (k) => (k <= 0 ? 0 : k >= 1 ? 1 : 1 - Math.exp(-6 * k) * Math.cos(9 * k));
function rng(seed) {
  let s = seed % 2147483647 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
const loadImage = (src) =>
  new Promise((ok, fail) => {
    const im = new Image();
    im.onload = () => ok(im);
    im.onerror = () => fail(new Error(`could not load ${src}`));
    im.src = src;
  });

/** Repaint an image (or a flat underpainting) as short oil strokes that take its colours. */
function strokes(w, h, under, o = {}) {
  const r = rng(o.seed ?? 3);
  const base = document.createElement('canvas');
  base.width = w; base.height = h;
  const bg = base.getContext('2d');
  under(bg, w, h, r);
  const src = bg.getImageData(0, 0, w, h).data;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  g.drawImage(base, 0, 0);
  const [l0, l1] = o.len, [w0, w1] = o.width, n = Math.round((w * h) / 90);
  const col = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const x = r() * w, y = r() * h, k = (Math.floor(y) * w + Math.floor(x)) * 4;
    col.setRGB(src[k] / 255, src[k + 1] / 255, src[k + 2] / 255, THREE.SRGBColorSpace);
    col.offsetHSL((r() - 0.5) * 0.03, (r() - 0.5) * 0.1, (r() - 0.5) * (o.vary ?? 0.12));
    const L = l0 + r() * (l1 - l0), W = w0 + r() * (w1 - w0);
    const a = o.angle === undefined ? r() * Math.PI : o.angle + (r() - 0.5) * (o.jitter ?? 0.5) * 2;
    g.save(); g.translate(x, y); g.rotate(a);
    g.fillStyle = `#${col.getHexString()}`;
    g.beginPath();
    g.moveTo(-L / 2, 0);
    g.bezierCurveTo(-L / 2, -W * 0.62, L / 2, -W * 0.38, L / 2, 0);
    g.bezierCurveTo(L / 2, W * 0.38, -L / 2, W * 0.62, -L / 2, 0);
    g.fill();
    g.globalAlpha = 0.5; g.lineCap = 'round';
    g.strokeStyle = `#${col.clone().offsetHSL(0, -0.05, 0.16).getHexString()}`; g.lineWidth = Math.max(1, W * 0.18);
    g.beginPath(); g.moveTo(-L * 0.38, -W * 0.2); g.lineTo(L * 0.4, -W * 0.12); g.stroke();
    g.strokeStyle = `#${col.clone().offsetHSL(0, 0.05, -0.16).getHexString()}`; g.lineWidth = Math.max(1, W * 0.14);
    g.beginPath(); g.moveTo(-L * 0.4, W * 0.26); g.lineTo(L * 0.36, W * 0.16); g.stroke();
    g.restore();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  if (o.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...o.repeat); }
  return t;
}

/** Visible bounds of an image's alpha, in uv (0..1, v up), so planes hug the painted shape. */
function alphaBounds(im) {
  const W = 256, H = Math.round((256 * im.height) / im.width);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(im, 0, 0, W, H);
  const d = g.getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] > 215) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { u0: x0 / W, u1: (x1 + 1) / W, v0: 1 - (y1 + 1) / H, v1: 1 - y0 / H };
}

const radial = (inner, outer) => {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d'), r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, inner); r.addColorStop(1, outer);
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return t;
};
const PLANE_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';

export function createStudioScene(canvas, { base, cast, onPick, reducedMotion = false }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#e8d6b8');
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 60);
  const look = new THREE.Vector3();
  const disposables = [];
  const keep = (x) => (disposables.push(x), x);

  let disposed = false, ready = false, T0 = 0, selected = null, panel = 0;
  const clock = () => performance.now() / 1000 - T0;

  async function tex(path) {
    const im = await loadImage(base + path);
    const t = keep(new THREE.Texture(im));
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.needsUpdate = true;
    return t;
  }
  /** A painted piece of the set, standing on its bottom edge (pivot there, so it can hinge up). */
  async function piece(path, height, { opaque = false, material, segs = 1 } = {}) {
    const t = await tex(path), im = t.image;
    const b = opaque ? { u0: 0, u1: 1, v0: 0, v1: 1 } : alphaBounds(im);
    const w = height * (((b.u1 - b.u0) * im.width) / ((b.v1 - b.v0) * im.height));
    const geo = keep(new THREE.PlaneGeometry(w, height, segs, segs).translate(0, height / 2, 0));
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, lerp(b.u0, b.u1, uv.getX(i)), lerp(b.v0, b.v1, uv.getY(i)));
    const mat = material ?? keep(new THREE.MeshBasicMaterial({ map: t, transparent: !opaque, alphaTest: opaque ? 0 : 0.42 }));
    if (material) material.uniforms.map.value = t;
    const pivot = new THREE.Group();
    pivot.add(new THREE.Mesh(geo, mat));
    pivot.userData = { w, h: height, b, image: im };
    return pivot;
  }
  const shadowTex = keep(radial('rgba(70,40,20,.55)', 'rgba(70,40,20,0)'));
  function shadow(w, d) {
    const m = new THREE.Mesh(keep(new THREE.PlaneGeometry(w, d)), keep(new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false })));
    m.rotation.x = -Math.PI / 2; m.position.y = 0.004;
    return m;
  }

  const set = [];
  const place = (obj, x, y, z, at, kind = 'hinge', extra = {}) => {
    obj.position.set(x, y, z); scene.add(obj);
    set.push({ obj, at, kind, base: obj.position.clone(), ...extra });
    return obj;
  };
  const paints = [];
  let birds, beam1, beam2, plant, flowers, dust, dustPos, dustSeed, falling, shafts = [], ring;
  const R = rng(77);

  async function build() {
    const floorTex = keep(strokes(512, 512, (g, w, h, r) => {
      g.fillStyle = '#c08552'; g.fillRect(0, 0, w, h);
      g.globalAlpha = 0.55;
      for (let i = 0; i < 90; i++) {
        g.fillStyle = ['#cf9560', '#a86f42', '#e0b37e', '#9aa8c8', '#b47a48'][i % 5];
        g.beginPath(); g.ellipse(r() * w, r() * h, 30 + r() * 60, 10 + r() * 16, 0, 0, 7); g.fill();
      }
      g.globalAlpha = 1;
    }, { len: [24, 50], width: [10, 18], angle: 0, jitter: 0.3, repeat: [3, 3], seed: 21 }));
    // drawn first and writes no depth, so the palette can dip below it near the camera
    const floor = new THREE.Mesh(keep(new THREE.PlaneGeometry(14, 18)), keep(new THREE.MeshBasicMaterial({ map: floorTex, depthWrite: false })));
    floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, 2); floor.renderOrder = -1; scene.add(floor);

    const wall = await piece('wall-windows.webp', 3.7, { opaque: true });
    place(wall, 0.42, 0, -3.0, 0.0);
    // birds over the garden, visible only inside the window glass
    birds = new THREE.Mesh(wall.children[0].geometry, keep(new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 } }, transparent: true, depthWrite: false,
      vertexShader: PLANE_VS,
      fragmentShader: `uniform float time; varying vec2 vUv;
        float glass(vec2 u) {
          float a = step(0.415, u.x) * step(u.x, 0.62) + step(0.74, u.x) * step(u.x, 0.95);
          return a * step(0.2, u.y) * step(u.y, 0.8);
        }
        float bird(vec2 p, float flap) {
          p.x = abs(p.x);
          float y = flap * p.x - 1.3 * p.x * p.x;
          return (1.0 - smoothstep(0.05, 0.12, abs(p.y - y))) * (1.0 - step(0.55, p.x));
        }
        void main(){
          float a = 0.0;
          for (int i = 0; i < 4; i++) {
            float fi = float(i);
            float x = fract(time * (0.075 + 0.02 * fi) + fi * 0.37) * 1.6 - 0.3;
            float y = 0.6 + 0.12 * fract(fi * 0.61) + 0.015 * sin(time * 1.7 + fi * 2.0);
            vec2 p = vec2(vUv.x - x, (vUv.y - y) * 0.672) / (0.016 + 0.004 * fi);
            a = max(a, bird(p, 0.7 * sin(time * (11.0 + fi)) + 0.2));
          }
          a *= glass(vUv);
          if (a < 0.02) discard;
          gl_FragColor = vec4(vec3(0.22, 0.17, 0.2), a * 0.85);
          #include <colorspace_fragment>
        }`,
    })));
    birds.position.z = 0.003; wall.children[0].add(birds);

    // ceiling and side walls from the plain left part of the same painted wall
    const plain = await tex('wall-windows.webp');
    {
      const g = keep(new THREE.PlaneGeometry(9, 7));
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.36, 0.25 + uv.getY(i) * 0.7);
      const m = new THREE.Mesh(g, keep(new THREE.MeshBasicMaterial({ map: plain, color: 0xf2e6d6, side: THREE.DoubleSide })));
      m.position.set(0.3, 4.7, -1.5); m.rotation.set(Math.PI / 2 - 0.45, 0, 0); scene.add(m);
      set.push({ obj: m, at: 0.35, kind: 'fade' });
    }
    for (const [x, ry] of [[-2.33, Math.PI / 2], [3.17, -Math.PI / 2]]) {
      const g = keep(new THREE.PlaneGeometry(7, 4.6).translate(0, 2.3, 0));
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.36, uv.getY(i) * 0.95);
      const m = new THREE.Mesh(g, keep(new THREE.MeshBasicMaterial({ map: plain, color: 0xe9dccb })));
      m.position.set(x, 0, 0.5); m.rotation.y = ry; scene.add(m);
    }
    const rug = await piece('rug.webp', 2.5, { opaque: true });
    rug.children[0].rotation.x = -Math.PI / 2; rug.children[0].position.set(0, 0.006, 1.25);
    place(rug, 0.15, 0, -1.25, 1.2, 'unroll');

    place(await piece('bookshelf.webp', 2.65), -1.55, 0, -2.6, 0.55).add(shadow(1.6, 0.5));
    const easel = await piece('easel.webp', 2.15);
    place(easel, -0.35, 0, -2.0, 0.8).add(shadow(1.3, 0.45));
    plant = await piece('plant.webp', 1.45);
    place(plant, 1.75, 0, -2.25, 1.0).add(shadow(0.9, 0.35));
    place(await piece('stool.webp', 0.78), 0.8, 0, -1.7, 1.05).add(shadow(0.7, 0.3));
    flowers = await piece('sunflowers.webp', 1.05);
    place(flowers, 2.05, 0.6, -2.92, 0.9);
    { // the painting on the easel: a real artwork, re-laid in brushstrokes
      const im = await loadImage(base + 'easel-painting.jpg');
      const map = keep(strokes(512, Math.round((512 * im.height) / im.width), (g, w, h) => g.drawImage(im, 0, 0, w, h),
        { len: [8, 18], width: [4, 8], vary: 0.06, seed: 12 }));
      const { w, h, b } = easel.userData;
      const U = (u) => ((u - (b.u0 + b.u1) / 2) / (b.u1 - b.u0)) * w, V = (v) => ((v - b.v0) / (b.v1 - b.v0)) * h;
      const [cu0, cu1, cv0, cv1] = [0.18, 0.82, 0.43, 0.772]; // the blank canvas inside easel.webp
      const art = new THREE.Mesh(keep(new THREE.PlaneGeometry(U(cu1) - U(cu0), V(cv1) - V(cv0))), keep(new THREE.MeshBasicMaterial({ map })));
      art.position.set((U(cu0) + U(cu1)) / 2, (V(cv0) + V(cv1)) / 2, 0.01);
      easel.children[0].add(art);
    }
    beam1 = await piece('beam-vines.webp', 0.95);
    place(beam1, 0.2, 3.2, -2.85, 0.45, 'drop');
    beam2 = await piece('beam-vines.webp', 1.25);
    place(beam2, 0.3, 2.95, 1.2, 0.6, 'drop');
    beam2.children[0].scale.x = -1;

    const palette = await piece('palette.webp', 3.0);
    palette.children[0].rotation.x = -1.12;
    place(palette, 0.05, -0.6, 3.6, 1.8, 'rise');
    place(await piece('brush-jar.webp', 1.25), -0.98, -0.1, 3.15, 1.95, 'rise');

    // the order a painter gets painted in: one grey level per stroke, bottom first
    const order = (() => {
      const S = 256, r = rng(31), cv = document.createElement('canvas');
      cv.width = cv.height = S;
      const g = cv.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, S, S);
      const st = Array.from({ length: 150 }, () => ({ x: r() * S, y: r() * S, a: (r() - 0.5) * 1.3, l: 40 + r() * 50, w: 16 + r() * 18, key: 0 }));
      for (const s of st) s.key = -s.y + (r() - 0.5) * 70;
      st.sort((p, q) => p.key - q.key);
      st.forEach((s, i) => {
        const v = Math.round(((i + 1) / st.length) * 250);
        g.save(); g.translate(s.x, s.y); g.rotate(s.a); g.fillStyle = `rgb(${v},${v},${v})`;
        g.beginPath(); g.ellipse(0, 0, s.l / 2, s.w / 2, 0, 0, 7); g.fill(); g.restore();
      });
      const t = keep(new THREE.CanvasTexture(cv)); t.minFilter = t.magFilter = THREE.NearestFilter;
      return t;
    })();
    const paintMat = (color, seed, arms) => keep(new THREE.ShaderMaterial({
      uniforms: {
        map: { value: null }, map2: { value: null }, order: { value: order }, reveal: { value: 0 }, blink: { value: 0 },
        rect1: { value: new THREE.Vector4(0, 1, 0, 1) }, rect2: { value: new THREE.Vector4(0, 1, 0, 1) },
        size: { value: new THREE.Vector2(1, 1) }, time: { value: 0 }, seed: { value: seed }, arms: { value: arms }, live: { value: 0 },
        tint: { value: new THREE.Color(color) },
      },
      transparent: true,
      vertexShader: `uniform vec2 size; uniform float time, seed, arms, live; varying vec2 vUv;
        void main(){
          vUv = uv;
          vec3 p = position;
          float hy = p.y / size.y, ax = abs(p.x) / size.x;
          float b = sin(time * 2.3 + seed) * live;
          p.y *= 1.0 + 0.035 * b; p.x *= 1.0 - 0.02 * b;
          p.x += sin(time * 0.9 + seed) * 0.03 * hy * hy * size.y * live;
          float side = sign(p.x);
          float hand = smoothstep(0.2, 0.42, ax) * smoothstep(0.05, 0.28, hy) * (1.0 - smoothstep(0.5, 0.75, hy));
          float w = time * 3.2 + seed + side * 1.4;
          p.y += hand * arms * live * sin(w) * 0.07 * size.y;
          p.x += hand * arms * live * cos(w) * 0.03 * size.x * side;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `uniform sampler2D map; uniform sampler2D map2; uniform sampler2D order; uniform vec4 rect1; uniform vec4 rect2;
        uniform float reveal; uniform float blink; uniform vec3 tint; varying vec2 vUv;
        void main(){
          vec2 l = (vUv - rect1.xz) / (rect1.yw - rect1.xz);
          vec4 c = blink > 0.5 ? texture2D(map2, rect2.xz + l * (rect2.yw - rect2.xz)) : texture2D(map, vUv);
          if (c.a < 0.42) discard;
          float o = texture2D(order, vUv).r;
          if (o > reveal) discard;
          float wet = smoothstep(reveal - 0.12, reveal, o);
          gl_FragColor = vec4(mix(c.rgb, tint * 1.1, wet * 0.8), c.a);
          #include <colorspace_fragment>
        }`,
    }));
    const puddleMat = (color) => keep(new THREE.ShaderMaterial({
      uniforms: { map: { value: null }, tint: { value: new THREE.Color(color) } },
      transparent: true,
      vertexShader: PLANE_VS,
      fragmentShader: `uniform sampler2D map; uniform vec3 tint; varying vec2 vUv;
        void main(){
          vec4 c = texture2D(map, vUv); if (c.a < 0.42) discard;
          float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
          gl_FragColor = vec4(mix(tint * pow(l, 1.6) * 1.35, vec3(1.0), smoothstep(0.88, 1.0, l) * 0.7), c.a);
          #include <colorspace_fragment>
        }`,
    }));
    // the selected painter stands in a soft rose glow
    ring = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.62, 0.22)), keep(new THREE.MeshBasicMaterial({
      map: keep(radial('rgba(255,120,150,.85)', 'rgba(255,120,150,0)')), transparent: true, depthWrite: false, opacity: 0,
    })));
    ring.rotation.x = -Math.PI / 2 + 0.5; scene.add(ring);

    const onPal = (zz) => -0.6 + (3.6 - zz) * 0.485 + 0.03; // palette surface height at depth zz
    const n = cast.length;
    for (const [i, c] of cast.entries()) {
      const t = n > 1 ? (i - (n - 1) / 2) / ((n - 1) / 2) : 0, back = i % 2 ? 0.26 : 0;
      const x = 0.09 + t * 0.68, z = 1.5 - back + 0.08 * t * t;
      place(await piece('puddle-white.webp', 0.14, { material: puddleMat(c.color) }), x, onPal(z) - 0.035, z - 0.03, 2.8 + i * 0.1, 'pop');
      const mat = paintMat(c.color, i * 1.7, c.arms ?? 0.7);
      const ch = await piece(c.src, 0.46, { material: mat, segs: 16 });
      const { b, w, h } = ch.userData;
      mat.uniforms.rect1.value.set(b.u0, b.u1, b.v0, b.v1);
      mat.uniforms.size.value.set(w, h);
      let canBlink = false;
      if (c.blink) {
        const closed = await tex(c.blink).catch(() => null);
        if (closed) {
          const b2 = alphaBounds(closed.image);
          mat.uniforms.map2.value = closed; mat.uniforms.rect2.value.set(b2.u0, b2.u1, b2.v0, b2.v1);
          canBlink = true;
        }
      }
      place(ch, x, onPal(z) + 0.01, z, 3.2 + i * 0.3, 'paint', { mat });
      paints.push({ id: c.id, ch, mat, hop: -9, nextBlink: 6 + i * 0.7, canBlink });
    }

    // light shafts, dust in the sun, leaves and petals drifting down past the windows
    const shaftTex = (() => {
      const cv = document.createElement('canvas'); cv.width = 64; cv.height = 256;
      const g = cv.getContext('2d'), r = g.createLinearGradient(0, 0, 0, 256);
      r.addColorStop(0, 'rgba(255,236,190,0)'); r.addColorStop(0.25, 'rgba(255,236,190,.35)'); r.addColorStop(1, 'rgba(255,236,190,0)');
      g.fillStyle = r; g.fillRect(0, 0, 64, 256);
      const t = keep(new THREE.CanvasTexture(cv)); t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    for (const x of [0.75, 1.95]) {
      const m = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.9, 3.4)), keep(new THREE.MeshBasicMaterial({ map: shaftTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })));
      m.position.set(x - 0.45, 1.1, -1.9); m.rotation.set(-0.85, 0, 0.3); scene.add(m); shafts.push(m);
    }
    const DUST = 170;
    dustSeed = []; dustPos = new Float32Array(DUST * 3);
    for (let i = 0; i < DUST; i++) dustSeed.push([-0.3 + R() * 2.6, 0.3 + R() * 2.6, -2.7 + R() * 2.2, R() * 6.3, 0.5 + R()]);
    dust = new THREE.Points(keep(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(dustPos, 3))),
      keep(new THREE.PointsMaterial({ map: keep(radial('rgba(255,255,255,1)', 'rgba(255,255,255,0)')), color: 0xfff1c8, size: 0.035, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })));
    scene.add(dust);
    const leafTex = (col) => {
      const cv = document.createElement('canvas'); cv.width = 64; cv.height = 40;
      const g = cv.getContext('2d');
      g.fillStyle = col; g.beginPath(); g.ellipse(32, 20, 28, 14, 0, 0, 7); g.fill();
      g.fillStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.ellipse(26, 15, 14, 5, -0.2, 0, 7); g.fill();
      const t = keep(new THREE.CanvasTexture(cv)); t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    const FALL = ['#6fae4a', '#4f8f3a', '#f4a6c4', '#ffd35c'].map((c) => keep(new THREE.MeshBasicMaterial({ map: leafTex(c), transparent: true, depthWrite: false, side: THREE.DoubleSide })));
    const leafGeo = keep(new THREE.PlaneGeometry(0.07, 0.045));
    falling = Array.from({ length: 14 }, (_, i) => {
      const m = new THREE.Mesh(leafGeo, FALL[i % 4]);
      m.userData = { x: -0.6 + R() * 2.8, z: -2.7 + R() * 1.6, off: R() * 20, speed: 0.12 + R() * 0.1, sway: 0.2 + R() * 0.25 };
      scene.add(m);
      return m;
    });
  }

  function pose(T) {
    for (const s of set) {
      const k = seg(T, s.at, s.kind === 'paint' ? 1.3 : 0.75), o = s.obj, ch = o.children[0];
      o.visible = k > 0 || s.kind === 'fade';
      if (s.kind === 'paint') {
        s.mat.uniforms.reveal.value = k >= 1 ? 1.01 : io(k);
        const pk = seg(T, s.at + 1.3, 0.45), sq = 1 + Math.sin(pk * Math.PI) * 0.09;
        o.scale.set(1 / Math.sqrt(sq), sq, 1);
      }
      if (s.kind === 'hinge') ch.rotation.x = (1 - spring(k)) * (-Math.PI / 2);
      if (s.kind === 'drop') o.position.y = s.base.y + (1 - spring(k)) * 2.2;
      if (s.kind === 'fade') { o.material.transparent = true; o.material.opacity = out(seg(T, s.at, 1)); }
      if (s.kind === 'unroll') o.scale.set(1, 1, Math.max(0.001, out(k)));
      if (s.kind === 'rise') o.position.y = s.base.y - (1 - spring(k)) * 1.6;
      if (s.kind === 'pop') o.scale.setScalar(Math.max(0.001, spring(k)));
    }
    for (const m of shafts) m.material.opacity = (0.6 + 0.15 * Math.sin(T * 0.7 + m.position.x)) * io(seg(T, 1.4, 1.2));
  }

  let nextHop = 7;
  function life(T) {
    dust.material.opacity = 0.85 * io(seg(T, 1.6, 1.5));
    for (let i = 0; i < dustSeed.length; i++) {
      const [x, y, z, ph, sp] = dustSeed[i];
      dustPos[i * 3] = x + Math.sin(T * 0.21 * sp + ph) * 0.15;
      dustPos[i * 3 + 1] = 0.3 + ((y + T * 0.04 * sp) % 2.6);
      dustPos[i * 3 + 2] = z + Math.cos(T * 0.17 * sp + ph) * 0.12;
    }
    dust.geometry.attributes.position.needsUpdate = true;
    for (const m of falling) {
      const u = m.userData;
      m.visible = T > 1.5;
      m.position.set(u.x + Math.sin(T * 1.3 + u.off) * u.sway, 3.3 - ((T * u.speed + u.off) % 3.4), u.z);
      m.rotation.set(Math.sin(T * 2 + u.off) * 1.2, T * 0.8 + u.off, Math.cos(T * 1.7 + u.off));
    }
    beam1.children[0].rotation.z = Math.sin(T * 0.6) * 0.006;
    beam2.children[0].rotation.z = Math.sin(T * 0.5 + 1) * 0.008;
    plant.children[0].rotation.z = Math.sin(T * 0.9) * 0.03;
    flowers.children[0].rotation.z = Math.sin(T * 0.7 + 2) * 0.025;
    birds.material.uniforms.time.value = T;
    if (T > nextHop && paints.length) {
      const idle = paints.filter((p) => p.id !== selected);
      if (idle.length) idle[Math.floor(R() * idle.length)].hop = T;
      nextHop = T + 2.5 + R() * 3.5;
    }
    for (const p of paints) {
      const u = p.mat.uniforms;
      u.time.value = T; u.live.value = io(seg(T, 5.2, 1.2));
      if (p.canBlink && T > p.nextBlink) {
        u.blink.value = 1;
        if (T > p.nextBlink + 0.13) { u.blink.value = 0; p.nextBlink = T + (R() < 0.2 ? 0.25 : 2 + R() * 3.5); }
      }
      const h = T - p.hop, isSel = p.id === selected;
      let sy = 1, y = 0;
      if (h >= 0 && h < 0.7) { const k = h / 0.7; y = Math.sin(Math.PI * k) * 0.22; sy = k < 0.15 ? 0.85 : k > 0.85 ? 0.9 : 1.08; }
      const grow = isSel ? 1.1 : 1;
      p.ch.children[0].scale.set(grow / Math.sqrt(sy), grow * sy, 1);
      p.ch.children[0].position.y = y;
    }
    const sel = paints.find((p) => p.id === selected);
    ring.material.opacity = lerp(ring.material.opacity, sel ? 0.9 : 0, 0.15);
    if (sel) ring.position.set(sel.ch.position.x, sel.ch.position.y + 0.02, sel.ch.position.z + 0.02);
  }

  /*
   * Framing. Portrait phones see the frame of the reference painting: walls on top, painters on the
   * palette below. Wider screens see more of the room; when the UI takes a column on the left, the
   * picture is shifted right so the painters stay clear of it.
   */
  let W = 1, H = 1;
  function frame(T) {
    const a = W / H, wide = clamp01((a - 0.75) / 0.85); // 0 = phone portrait, 1 = laptop landscape
    camera.fov = lerp(45 * Math.max(1, 0.46 / a), 38, wide);
    const cam = new THREE.Vector3(lerp(0, 0.25, wide), lerp(1.95, 1.8, wide), lerp(6.3, 5.5, wide));
    const tgt = new THREE.Vector3(lerp(0.1, 0.3, wide), lerp(1.15, 1.0, wide), lerp(0, -0.5, wide));
    const intro = reducedMotion ? 1 : io(seg(T, 0, 5.6));
    const swing = Math.sin(intro * Math.PI) * 0.6;
    camera.position.set(
      lerp(2.3, cam.x, intro) + swing * 0.5 + Math.sin(T * 0.25) * 0.12 * intro + pointer.x * 0.25,
      lerp(5.3, cam.y, intro) + Math.sin(T * 0.33) * 0.05 * intro - pointer.y * 0.12,
      lerp(9.4, cam.z, intro));
    look.set(lerp(-0.2, tgt.x, intro), lerp(1.4, tgt.y, intro), lerp(-1.6, tgt.z, intro));
    camera.lookAt(look);
    const shift = Math.round(panel * wide * 0.5);
    if (shift > 0) camera.setViewOffset(W + 2 * shift, H, 0, 0, W, H);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }
  function resize() {
    W = Math.max(1, canvas.clientWidth); H = Math.max(1, canvas.clientHeight);
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  const pointer = new THREE.Vector2();
  const ray = new THREE.Raycaster();
  const onMove = (e) => {
    const r = canvas.getBoundingClientRect();
    pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1);
  };
  const onDown = (e) => {
    if (!ready) return;
    const r = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(paints.map((p) => p.ch), true)[0];
    const p = hit && paints.find((q) => q.ch.children.includes(hit.object));
    if (p) { p.hop = clock(); onPick?.(p.id); }
  };
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerdown', onDown);
  const onVisible = () => renderer.setAnimationLoop(document.hidden || disposed ? null : loop);
  document.addEventListener('visibilitychange', onVisible);

  function loop() {
    const T = clock();
    pose(T); life(T); frame(T);
    renderer.render(scene, camera);
  }
  build().then(() => {
    if (disposed) return;
    T0 = performance.now() / 1000 - (reducedMotion ? 9 : 0);
    ready = true;
    onVisible();
  }).catch((err) => console.error('studio scene', err));

  return {
    select(id) {
      if (id !== selected) { const p = paints.find((q) => q.id === id); if (p) p.hop = clock(); }
      selected = id;
    },
    setPanel(px) { panel = px; },
    replay() { T0 = performance.now() / 1000; },
    dispose() {
      disposed = true;
      renderer.setAnimationLoop(null);
      ro.disconnect();
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onDown);
      document.removeEventListener('visibilitychange', onVisible);
      for (const d of disposables) d.dispose?.();
      renderer.dispose();
    },
  };
}
