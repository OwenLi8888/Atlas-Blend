---
name: threejs-pet
description: House rules for three.js in the Blend repo (the 3D beaver pet, the globe, any scene in the app's WebView). Use before writing or changing three.js code, picking materials or animation, or checking a scene on the iPhone.
---

# three.js for the Blend beaver

The owner designs; teammates own app logic. Every scene ships inside `react-native-webview` on an
iPhone, so the phone is the judge, not the laptop. Evidence for every rule below:
`design/research/20261114-threejs/README.md` (quotes in `claims/*.json`).

## Steps

1. **Pin the version.** three `0.187.0` as an ES module, served by the API server and mapped
   with an import map (`"three": "/vendor/three.module.js"`); `WebGLRenderer` only. Training data
   mixes pre-r152 code: check any API you are unsure of against
   `https://threejs.org/docs/llms.txt` or the Migration Guide before writing it.
2. **Study first.** Start every new scene as a single HTML file in `design/studies/`, built
   against a concrete reference (the Gemini sheets in `design/beaver/`, a URL, a video): recreate
   it, self-verify until it matches, then mold it into our style with concrete vocabulary
   (orbit, parallax, transparent layers, squash and stretch). Offer the owner 2-3 variants
   before committing a look.
3. **Build** from the Look and Life sections below. One scene file per screen, the same
   `G.*` command and `{type: ...}` message contract the globe uses.
4. **Verify** until the scene is _green_: a canvas screenshot that looks right (accessibility
   snapshots show no pixels), `renderer.info.render.calls` within budget, then the same page in
   WebKit (iOS Simulator or the owner's iPhone) holding about 60 fps at the clamped pixel ratio.
5. **Save what worked.** When an effect or recipe lands, add it to this skill so the next scene
   reuses it.

## Version traps

| Stale code | Current |
|---|---|
| `outputEncoding`, `texture.encoding`, `sRGBEncoding` | `outputColorSpace`, `texture.colorSpace`, `SRGBColorSpace` (r152) |
| `physicallyCorrectLights`, old light intensities | physical light units by default (r155): retune intensities by eye |
| `examples/js`, `three.min.js`, global `THREE` | ES modules, `three/addons/...` (r148, r161) |
| WebGL 1 fallbacks | WebGL 2 only (r163) |
| `PostProcessing`, `varying()` in TSL | `RenderPipeline`, `toVarying()`: avoid WebGPU/TSL here |

## Phone budget

- `renderer.setPixelRatio(Math.min(devicePixelRatio, 2))`; step down to 1.5 or 1.25 when the
  frame rate drops.
- Draw calls: a few hundred at most. Voxels and repeated parts go in one `InstancedMesh`.
- `renderer.setAnimationLoop(fn)`; `setAnimationLoop(null)` when the pet sleeps or the page hides.
- `antialias` is fixed at construction. Bloom, real shadows and `transmission` are unmeasured on
  iPhone: fake them (additive sprites, blob shadow, matcap) unless a phone test says otherwise.
- Create geometries, materials and textures once and reuse them; keep textures at 1024 px or less.
- Bridge: `postMessage` needs `onMessage` set on the WebView and takes one JSON string. Relative
  URLs resolve against `source.baseUrl`. Reload the WebView in `onContentProcessDidTerminate`.

## Look

- Glossy vinyl: `MeshMatcapMaterial` (lighting is baked into one texture, lights cost nothing).
  It never receives shadows: put a blurred blob-shadow plane under the pet.
- Toon bands: `MeshToonMaterial` with a `gradientMap` using `NearestFilter` for min and mag.
- Rim glow: fresnel term injected with `onBeforeCompile`.
- Body parts: `CapsuleGeometry` (its `height` excludes the caps), `LatheGeometry` profiles with
  all `x > 0` for a pear-shaped body or head, spheres for eyes and cheeks.
- Outline: inverted-hull shell (`BackSide`, slightly scaled), not `OutlinePass`.

## Night gallery (the chosen look, study in `design/studies/night-gallery.src.html`)

- World: near-black navy hall (`#05060c` fog and background), unlit materials only; light is faked
  with additive glow planes behind each gold-framed painting and a warm pool under the pet.
- Reflective floor: render the hall mirrored (`world.scale.y = -1`, floor and extras hidden) into a
  half-size `WebGLRenderTarget`, then the floor `ShaderMaterial` samples it at
  `gl_FragCoord.xy / res` with two sine offsets for ripples and a fresnel mix. About 80 draw calls
  for both passes with eight paintings and the beaver.
- Text that should reflect is a canvas texture on a plane inside `world`; draw it after
  `document.fonts.load(...)`.
- Phone portrait: corridor half-width 1.6, vertical fov 72; tap a painting to blend the camera
  into a frontal pose sized from the painting and the corridor width.
- Paper keepsakes (ticket card, handwritten note) stay in HTML over the canvas.
- Paintings are inlined by `design/studies/build_gallery.py`; edit the `.src.html`, rebuild, and
  preview through the `design-studies` server in `~/Developer/.claude/launch.json` (a file over
  about 500 KB does not open as `file://` in the Browser pane).

## Atmosphere (techniques read in `MengTo/kage` `index.html`, 2026-11-14)

That repo has no licence and runs an old three build (`outputEncoding`): take the ideas, write
our own code, never paste from it.

- Haze: 4-6 large additive planes with a soft radial canvas texture, opacity 0.05-0.12,
  `depthWrite: false`, `fog: false`, drifting on a slow sine. Cheap depth without real volumetrics.
- Falling pieces (leaves, petals, paint flecks): one `InstancedMesh` of small planes with
  `alphaTest`; per piece keep fall speed, sway phase and amplitude, roll and tilt speed. Respawn
  them in a disc ahead of the camera's view direction, not around the camera, so the same count
  fills the frame.
- Embers or dust: one `Points` with a per-point seed attribute; all motion is in the vertex
  shader (`mod` on y with time, sine drift on x and z), so the CPU cost is zero.
- Pointer trail: `Points` parented to the camera, emitted by distance travelled, not by a timer.
  Skip it on touch devices, as that repo does.
- Camera: two `CatmullRomCurve3` (position and look-at target) sampled by one eased progress
  value; on a tall screen step the camera back along its view axis and widen the fov instead of
  letting the sides crop.
- Tier switch: a `LOW` flag halves particle counts and drops MSAA; its bloom chain (half-float
  target, 4 blur levels, composite with grain and vignette) is desktop-grade and stays off on
  the phone until measured.

## Recipes from the flow studies (`design/studies/book.html`, `portal.html`, shared `pets.js`)

- Characters: one 16x16 sprite per pet in `pets.js` is the only source. It becomes a paper sticker
  (canvas texture, `NearestFilter`, white die-cut border), a voxel body (one `InstancedMesh`, four
  layers deep, outline pixels only on the two middle layers, face only on the front layer) and the
  app's LCD icon. A new pet is a new sprite and palette, nothing else.
- Page turn: a strip of `SEG` rows hinged on the spine; row angle is
  `clamp(t * PI - sin(PI * t) * 1.15 * row / SEG, 0, PI)` and positions are accumulated row by row,
  so the free edge lags and the page keeps its length. Front and back are two meshes sharing the
  position and normal attributes, with their own UVs and `FrontSide` / `BackSide` materials.
- Things standing on a page hop over a turning leaf: keep them in one group and lift it by
  `sin(PI * t)` during the turn.
- Cube pool: one `InstancedMesh` of about 700 unit cubes with per-instance colour. A painting is
  sampled to a small grid with `getImageData`; cubes fly from the grid to a pet (fed painting) or
  from two pets to the grid (the blend painting being built), then the real image fades in over them.
- Pixel look in a shader: snap `uv` with `floor(uv * N) / N` before computing the pattern.
- Driving a study from the Browser pane: when the pane is hidden the page gets few frames, so
  wait on state (a button appearing, a list length), never on fixed timeouts.
- Measured in the laptop browser at 375x812: book 32 draw calls, portal 10. Not yet on an iPhone.

## Life

The pet is never still. Every motion is a spring or an ease, never a linear tween.

- Spring: critically damped `value`/`velocity` state updated per frame with `delta`
  (same shape as maath `spring.damp`); write it inline instead of adding a dependency.
- Breathing: slow sine on body scale; squash and stretch keeps volume
  (`scale.y = s`, `scale.x = scale.z = 1 / Math.sqrt(s)`).
- Blink at random 2-6 s intervals; eyes and head follow the pointer through a spring.
- Tap: anticipation squash, jump, overshoot on landing. Long idle: sleep and pause the loop.
- Taste colours come from the gallery variables: the palette tail's paint dabs are the user's hues.
