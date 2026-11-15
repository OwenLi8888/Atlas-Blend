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

// Room layout shared by both modes. Easels: position, height, canvas width and default aspect.
const EASELS = [
  { x: -1.0, z: -2.4, h: 1.95, w: 0.86, aspect: 0.8 },
  { x: 0.2, z: -1.95, h: 2.1, w: 1.0, aspect: 1.25 },
  { x: 1.4, z: -2.4, h: 1.95, w: 0.86, aspect: 0.8 },
];
const LEDGE = 0.405;                              // canvas ledge, as a fraction of the easel's height
const LADDER_H = 1.2;
const LADDER_STEPS = [0, 0.15, 0.36, 0.55, 0.735, 0.93]; // floor, four treads, top: fractions of its height
const JAR = { x: 1.0, y: 0.3, z: -0.72 };       // the brush jar, standing on the crate
const BRUSH_LEN = 0.5;

export function createStudioScene(canvas, {
  base, cast, onPick, reducedMotion = false,
  mode = 'pick', painterId = null, works = [], sequence, onReady, onAllDone, onCanvas,
}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#e8d6b8');
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 60);
  const look = new THREE.Vector3();
  const disposables = [];
  // anything created after dispose() (a build still in flight) is freed at once
  const keep = (x) => {
    if (disposed) x.dispose?.();
    else disposables.push(x);
    return x;
  };

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
  const canvases = [];
  /** Sizes canvas `i` for a picture of this aspect (width / height), as large as its easel takes. */
  function shape(i, aspect) {
    const c = canvases[i];
    if (!c || !(aspect > 0)) return;
    c.w = c.maxW; c.h = c.w / aspect;
    if (c.h > c.maxH) { c.h = c.maxH; c.w = c.h * aspect; }
    c.edge.scale.set(c.w + 0.03, c.h + 0.03, 1);
    c.cloth.scale.set(c.w, c.h, 1);
  }
  let birds, beam1, beam2, plant, flowers, dust, dustPos, dustSeed, falling, shafts = [], ring, ladder, brush;
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
    const plain = wall.children[0].material.map;
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

    place(await piece('bookshelf.webp', 2.65), -2.0, 0, -2.85, 0.55).add(shadow(1.6, 0.5));
    plant = await piece('plant.webp', 1.45);
    place(plant, 2.7, 0, -2.6, 1.0).add(shadow(0.9, 0.35));
    place(await piece('stool.webp', 0.78), 2.35, 0, -1.2, 1.05).add(shadow(0.7, 0.3));
    flowers = await piece('sunflowers.webp', 1.05);
    place(flowers, 2.05, 0.6, -2.92, 0.9);

    // Three easels with blank canvases: the same room is the painting scene later, where the
    // chosen painter fills them one after another. A canvas takes any aspect ratio.
    const blank = await tex('canvas-blank.webp');
    const unit = keep(new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0));
    const edgeMat = keep(new THREE.MeshBasicMaterial({ color: 0xb98a5c }));
    for (const [i, e] of EASELS.entries()) {
      const easel = await piece('easel-empty.webp', e.h);
      place(easel, e.x, 0, e.z, 0.7 + i * 0.12).add(shadow(e.h * 0.6, 0.4));
      const by = e.h * LEDGE;
      const edge = new THREE.Mesh(unit, edgeMat);                       // stretcher edge behind the cloth
      edge.position.set(0, by - 0.015, 0.012);
      const cloth = new THREE.Mesh(unit, keep(new THREE.MeshBasicMaterial({ map: blank })));
      cloth.position.set(0, by, 0.018);
      easel.children[0].add(edge, cloth);
      canvases.push({ cloth, edge, x: e.x, by, w: 0, h: 0, z: e.z + 0.02, maxW: e.w, maxH: e.h * 0.66 });
      shape(i, works[i]?.aspect ?? e.aspect);
    }
    ladder = await piece('stepladder.webp', LADDER_H);
    ladder.children[0].scale.x = 0.82;
    place(ladder, -0.5, 0, -1.55, 1.25).add(shadow(0.8, 0.3));
    const crate = await piece('crate.webp', 0.4);
    place(crate, JAR.x - 0.1, 0, JAR.z + 0.04, 1.4).add(shadow(0.75, 0.3));
    place(await piece('brush-jar.webp', 0.62), JAR.x, JAR.y, JAR.z, 1.55, 'pop');
    beam1 = await piece('beam-vines.webp', 0.95);
    place(beam1, 0.2, 3.2, -2.85, 0.45, 'drop');
    beam2 = await piece('beam-vines.webp', 1.25);
    place(beam2, 0.3, 2.95, 1.2, 0.6, 'drop');
    beam2.children[0].scale.x = -1;

    const palette = await piece('palette.webp', 3.0);
    palette.children[0].rotation.x = -1.12;
    place(palette, 0.05, -0.6, 3.6, 1.8, 'rise');

    // the brush the painter takes from the jar: pivot at the bristle tip, handle along +x
    {
      const t = await tex('brush.webp'), b = alphaBounds(t.image);
      const len = BRUSH_LEN, wid = len * (((b.v1 - b.v0) * t.image.height) / ((b.u1 - b.u0) * t.image.width));
      const geo = keep(new THREE.PlaneGeometry(len, wid).translate(len / 2, 0, 0));
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, lerp(b.u0, b.u1, uv.getX(i)), lerp(b.v0, b.v1, uv.getY(i)));
      brush = new THREE.Mesh(geo, keep(new THREE.ShaderMaterial({
        uniforms: { map: { value: t }, tint: { value: new THREE.Color('#ffffff') } },
        transparent: true,
        vertexShader: PLANE_VS,
        // only the white paint on the bristles takes the painter's colour
        fragmentShader: `uniform sampler2D map; uniform vec3 tint; varying vec2 vUv;
          void main(){
            vec4 c = texture2D(map, vUv); if (c.a < 0.42) discard;
            float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
            float white = smoothstep(0.62, 0.85, mx) * (1.0 - smoothstep(0.12, 0.3, mx - mn)) * step(vUv.x, 0.2);
            gl_FragColor = vec4(mix(c.rgb, tint * (0.55 + 0.6 * mx), white), c.a);
            #include <colorspace_fragment>
          }`,
      })));
      brush.visible = false; brush.renderOrder = 5; scene.add(brush);
    }

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
      m.position.set(x - 0.3, 0.75, -2.72); m.rotation.set(-1.1, 0, 0.3); scene.add(m); shafts.push(m);
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
        const z = s.size ?? 1; o.scale.set(z / Math.sqrt(sq), z * sq, 1);
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
      const idle = paints.filter((p) => p.id !== selected && p !== act.p);
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
   * Paint mode (screen 3). The chosen painter hops off the palette, takes a brush from the jar and
   * paints the canvases one after another. A stepladder shuffles along beside it: the painter
   * stands on whichever tread puts its hand next to the stroke. The screen owns the stroke players;
   * it is told when the painter is ready at a canvas and reports the brush position back.
   */
  const PAINT = mode === 'paint';
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const tweens = new Set();
  const tween = (dur, fn) => new Promise((res) => tweens.add({ t: 0, dur, fn, res }));
  const wait = (s) => tween(s, () => {});
  const act = { p: null, entry: null, held: false, work: -1, focus: -1, view: -1, side: 1, step: 0, u: 0.5, v: 0.5, tex: null };
  const tip = V(0, 0, 0), tipGoal = V(0, 0, 0), hand = V(0, 0, 0);
  let waiting = null; // resolves when the screen reports the current canvas finished
  let sink = 0;

  function hopTo(obj, to, dur = 0.42, arc = 0.3) {
    const from = obj.position.clone();
    return tween(dur, (k) => {
      obj.position.lerpVectors(from, to, io(k));
      obj.position.y += Math.sin(Math.PI * k) * arc;
    });
  }
  async function hopsTo(obj, to) {
    const from = obj.position.clone(), n = Math.max(1, Math.round(from.distanceTo(to) / 0.5));
    for (let i = 1; i <= n; i++) await hopTo(obj, from.clone().lerp(to, i / n), 0.3, 0.16);
  }
  /** The ladder waddles over, rocking from leg to leg. */
  function walkLadder(to) {
    const from = ladder.position.clone(), d = from.distanceTo(to), n = Math.max(2, Math.round(d * 4));
    return tween(Math.max(0.5, d / 1.3), (k) => {
      ladder.position.lerpVectors(from, to, io(k));
      ladder.position.y = Math.abs(Math.sin(k * Math.PI * n)) * 0.05;
      ladder.children[0].rotation.z = Math.sin(k * Math.PI * n) * 0.07;
    });
  }
  async function paintScript() {
    const me = paints.find((p) => p.id === painterId) ?? paints[0];
    const a = me.ch, entry = set.find((s) => s.obj === a), home = a.position.clone();
    act.p = me; act.entry = entry;
    brush.material.uniforms.tint.value.set(cast.find((c) => c.id === me.id)?.color ?? '#ffffff');
    await wait(0.8);
    me.hop = clock();                                                        // "me!"
    await wait(0.8);
    await hopTo(a, V(a.position.x * 0.5, 0.74, 0.98), 0.45, 0.25);          // to the far rim of the palette
    await Promise.all([                                                      // down onto the floor, growing a little
      hopTo(a, V(0.4, 0, -0.15), 0.6, 0.45),
      tween(0.6, (k) => (entry.size = lerp(1, 1.3, k))),
    ]);
    await hopTo(a, V(0.55, 0, -0.45), 0.36, 0.2);
    await hopTo(a, V(JAR.x - 0.34, JAR.y + 0.02, JAR.z + 0.08), 0.5, 0.4);  // up onto the crate, beside the jar
    tip.set(JAR.x, JAR.y + 0.55, JAR.z + 0.02);                              // the brush comes out of the jar
    brush.visible = true; act.held = true;
    await tween(0.35, (k) => brush.scale.setScalar(Math.max(0.01, spring(k))));
    await wait(0.3);
    await hopTo(a, V(0.2, 0, -1.0), 0.5, 0.35);
    for (const i of sequence ?? canvases.map((_, k) => k)) {
      if (!works[i] || !canvases[i]) continue;
      const c = canvases[i], sx = c.x + c.w * 0.5 + 0.1, sz = c.z + 0.42;
      act.focus = i;
      await Promise.all([walkLadder(V(sx, 0, c.z + 0.34)), hopsTo(a, V(sx - 0.5, 0, sz + 0.12))]);
      ladder.position.y = 0; ladder.children[0].rotation.z = 0;
      for (const s of [1, 2]) await hopTo(a, V(sx, LADDER_H * LADDER_STEPS[s], sz), 0.3, 0.2); // climb
      act.step = 2; act.side = 1; act.u = 0.5; act.v = 0.5;
      act.tex = keep(new THREE.CanvasTexture(works[i].canvas));
      act.tex.colorSpace = THREE.SRGBColorSpace;
      c.cloth.material.map = act.tex; c.cloth.material.needsUpdate = true;
      act.work = i;
      onReady?.(i);
      await new Promise((res) => (waiting = res));
      act.tex.needsUpdate = true;
      act.work = -1; act.tex = null; act.texW = 0; act.texH = 0;
      ladder.children[0].rotation.z = 0;
      me.hop = clock();                                                      // done with this one
      await wait(0.5);
      await hopTo(a, V(a.position.x - 0.45, 0, sz + 0.15), 0.45, 0.3);
    }
    act.focus = -1;
    // the ladder is put away by the wall, clear of the finished canvases
    walkLadder(V(2.5, 0, -1.7)).then(() => { ladder.position.y = 0; ladder.children[0].rotation.z = 0; });
    // back home onto the palette, brush in hand
    await hopsTo(a, V(home.x * 0.5, 0, -0.2));
    await Promise.all([
      hopTo(a, V(home.x * 0.6, 0.74, 0.98), 0.6, 0.5),
      tween(0.6, (k) => (entry.size = lerp(1.3, 1, k))),
    ]);
    await hopTo(a, home, 0.45, 0.25);
    for (let k = 0; k < 2; k++) { me.hop = clock(); await wait(0.75); }
    onAllDone?.();
  }
  /** Runs tweens and, while a canvas is being painted, keeps painter, ladder and brush on the stroke. */
  function paintLife(dt) {
    for (const t of tweens) {
      t.t += dt;
      const k = Math.min(1, t.t / t.dur);
      t.fn(k);
      if (k >= 1) { tweens.delete(t); t.res(); }
    }
    if (!act.p) return;
    // While the camera is in close on an easel, the palette and the painters waiting on it sink
    // out of the way; they come back up when the painter heads home.
    sink += ((act.focus >= 0 || act.view >= 0 ? 1.5 : 0) - sink) * (1 - Math.exp(-dt * 2.2));
    for (const e of set) {
      if (e === act.entry || !(e.kind === 'rise' || e.kind === 'pop' || e.kind === 'paint') || e.base.z < 0.5) continue;
      e.obj.position.y = e.base.y - sink;
    }
    const a = act.p.ch, s = act.entry.size ?? 1;
    if (act.work >= 0) {
      const c = canvases[act.work];
      tipGoal.set(c.x + (act.u - 0.5) * c.w, c.by + (1 - act.v) * c.h, c.z);
      tip.lerp(tipGoal, 1 - Math.exp(-dt * 16));
      if (tip.x < c.x - c.w * 0.14) act.side = 1; else if (tip.x > c.x + c.w * 0.14) act.side = -1;
      const px = tip.x + act.side * 0.46, feet = tip.y - 0.36;
      let best = 0;
      for (let j = 1; j < LADDER_STEPS.length; j++) if (Math.abs(LADDER_H * LADDER_STEPS[j] - feet) < Math.abs(LADDER_H * LADDER_STEPS[best] - feet)) best = j;
      act.step = best;
      a.position.x += (px - a.position.x) * (1 - Math.exp(-dt * 6));
      a.position.y += (LADDER_H * LADDER_STEPS[best] - a.position.y) * (1 - Math.exp(-dt * 9));
      a.position.z = c.z + 0.42;
      const lead = a.position.x - ladder.position.x;
      ladder.position.x += lead * (1 - Math.exp(-dt * 5));
      ladder.children[0].rotation.z = THREE.MathUtils.clamp(-lead * 0.5, -0.09, 0.09);
      hand.set(a.position.x - act.side * 0.17 * s, a.position.y + 0.25 * s, a.position.z + 0.03);
      // a texture keeps the size it was first uploaded with: if the sheet was resized, start over
      const img = act.tex.image;
      if (act.texW !== img.width || act.texH !== img.height) {
        if (act.texW) act.tex.dispose();
        act.texW = img.width; act.texH = img.height;
      }
      act.tex.needsUpdate = true;
    } else if (act.held) {
      hand.set(a.position.x - 0.17 * s, a.position.y + 0.25 * s, a.position.z + 0.03);
      tipGoal.set(hand.x - 0.08, hand.y + BRUSH_LEN * 0.92, hand.z);
      tip.lerp(tipGoal, 1 - Math.exp(-dt * 12));
    }
    if (act.held) {
      // the brush is drawn in the painter's depth; slide its tip along the view ray so that it
      // still lands on the stroke on screen
      const zb = hand.z, d = tip.z - camera.position.z;
      const r = Math.abs(d) > 1e-3 ? (zb - camera.position.z) / d : 1;
      brush.position.set(lerp(camera.position.x, tip.x, r), lerp(camera.position.y, tip.y, r), zb);
      const dx = hand.x - brush.position.x, dy = hand.y - brush.position.y;
      brush.rotation.z = Math.atan2(dy, dx);
      brush.scale.set(THREE.MathUtils.clamp(Math.hypot(dx, dy) / BRUSH_LEN, 0.6, 1.5), 1, 1);
    }
  }

  /*
   * Framing. Portrait phones see the frame of the reference painting: walls on top, painters on the
   * palette below. Wider screens see more of the room; when the UI takes a column on the left, the
   * picture is shifted right so the painters stay clear of it.
   */
  let W = 1, H = 1;
  const cam = new THREE.Vector3(), tgt = new THREE.Vector3();
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
  let camSet = false;
  function frame(T, dt) {
    const a = W / H, wide = clamp01((a - 0.75) / 0.85); // 0 = phone portrait, 1 = laptop landscape
    camera.fov = lerp(45 * Math.max(1, 0.46 / a), 38, wide);
    cam.set(lerp(0, 0.25, wide), lerp(1.95, 1.8, wide), lerp(6.3, 5.5, wide));
    tgt.set(lerp(0.1, 0.3, wide), lerp(1.15, 1.0, wide), lerp(0, -0.5, wide));
    if (PAINT) {
      // overview while the painter walks; close on the canvas it is working at
      if (act.focus >= 0) {
        const c = canvases[act.focus], cy = c.by + c.h * 0.45;
        const half = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
        const d = Math.max((c.w * 0.5 + 0.62) / (half * a), (c.h * 0.5 + 0.8) / half);
        tgt.set(c.x + 0.12, cy - 0.12, c.z);
        cam.set(c.x * 0.85 + 0.12, cy + 0.3, c.z + d);
      } else if (act.view >= 0) {
        // looking at a finished canvas: straight on and closer; on a phone it sits in the upper
        // half, above the card that explains it
        const c = canvases[act.view], cy = c.by + c.h * 0.5;
        const half = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
        const d = Math.max((c.w * 0.5 + 0.22) / (half * a), (c.h * 0.5 + 0.3) / half * lerp(1.9, 1, wide));
        tgt.set(c.x, cy - d * half * lerp(0.42, 0, wide), c.z);
        cam.set(c.x, tgt.y + 0.08, c.z + d);
      }
      const k = camSet ? 1 - Math.exp(-dt * 1.7) : 1;
      camSet = true;
      camPos.lerp(cam, k); camLook.lerp(tgt, k);
      camera.position.set(camPos.x + Math.sin(T * 0.25) * 0.05 + pointer.x * 0.12, camPos.y + Math.sin(T * 0.33) * 0.03 - pointer.y * 0.06, camPos.z);
      camera.lookAt(camLook);
      const shift = Math.round(panel * wide * 0.5);
      if (shift > 0) camera.setViewOffset(W + 2 * shift, H, 0, 0, W, H);
      else camera.clearViewOffset();
      camera.updateProjectionMatrix();
      return;
    }
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
    if (PAINT) {
      const on = ray.intersectObjects(canvases.map((c) => c.cloth))[0];
      if (on) return void onCanvas?.(canvases.findIndex((c) => c.cloth === on.object));
    }
    const hit = ray.intersectObjects(paints.map((p) => p.ch), true)[0];
    const p = hit && paints.find((q) => q.ch.children.includes(hit.object));
    if (p && p !== act.p) { p.hop = clock(); if (!PAINT) onPick?.(p.id); }
  };
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerdown', onDown);
  const onVisible = () => renderer.setAnimationLoop(document.hidden || disposed || !ready ? null : loop);
  document.addEventListener('visibilitychange', onVisible);

  let last = 0;
  function loop() {
    const T = clock(), now = performance.now() / 1000, dt = Math.min(0.05, last ? now - last : 0.016);
    last = now;
    pose(T); life(T);
    if (PAINT) paintLife(dt);
    frame(T, dt);
    renderer.render(scene, camera);
  }
  build().then(() => {
    if (disposed) return;
    // paint mode opens on the finished room: no arrival, the painters are already on the palette
    T0 = performance.now() / 1000 - (reducedMotion || PAINT ? 9 : 0);
    ready = true;
    onVisible();
    if (PAINT) paintScript();
  }).catch((err) => console.error('studio scene', err));

  return {
    select(id) {
      if (id !== selected) { const p = paints.find((q) => q.id === id); if (p) p.hop = clock(); }
      selected = id;
    },
    setPanel(px) { panel = px; },
    replay() { T0 = performance.now() / 1000; },
    setBrush(u, v) { act.u = u; act.v = v; },
    setAspect(i, aspect) { shape(i, aspect); },
    view(i) { act.view = i ?? -1; },
    workDone() { const go = waiting; waiting = null; go?.(); },
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

// Shared with the gallery scene (galleryScene.js), which is painted the same way.
export { rng, loadImage, strokes, alphaBounds, radial, lerp, clamp01 };
