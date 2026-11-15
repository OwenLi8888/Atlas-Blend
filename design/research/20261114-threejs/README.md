# three.js for the Blend beaver pet: research, 2026-11-14

Question: how do we get the best three.js work out of Claude Code for a stylized, living 3D pet
that runs on an iPhone inside the Expo app's WebView?

Method: three web-research lanes (tooling, mobile, character) on Fable, 63 claims, each with a
verbatim quote. Every quote was re-checked on its page with `curl` (`gate.tsv`): 48 matched
automatically, the other 15 were confirmed by hand (the misses were `<code>` tags and JS source
breaking the matcher, not wrong quotes). Raw claims with quotes and URLs: `claims/*.json`.
`s` marks a secondary source (forum post, third-party docs); everything else is primary.

## 1. How Claude should work with three.js

- **Read the official LLM docs first.** threejs.org publishes `https://threejs.org/llms.txt`,
  pointing to `docs/llms.txt` and `docs/llms-full.txt`. `docs/llms.txt` has an "Instructions for
  Large Language Models" section that marks the old import style wrong and an import map right;
  its import map pins `three@0.187.0`.
- **Use WebGLRenderer, not WebGPU.** The same guidance calls WebGLRenderer the default and mature
  choice; WebGPURenderer only for TSL, compute shaders or node materials. TSL/WebGPU names keep
  changing (r173 `varying()` became `toVarying()`, r183 `PostProcessing` became `RenderPipeline`).
- **Version traps an LLM falls into** (all from the official Migration Guide):
  | Release | Old code that breaks | Current |
  |---|---|---|
  | r148 | `examples/js` script builds | ES modules only (`three/addons/...`) |
  | r150 | `renderer.physicallyCorrectLights = true` | `useLegacyLights = false` (then removed) |
  | r152 | `outputEncoding`, `texture.encoding`, `sRGBEncoding` | `outputColorSpace`, `texture.colorSpace`, `SRGBColorSpace`; ColorManagement on by default |
  | r155 | light intensities from old tutorials | physically based units: old values look too dark or bright |
  | r161 | `<script src="three.min.js">` + global `THREE` | module build only |
  | r163 | WebGL 1 | WebGL 2 only |
  | r171 | WebGPU classes from `three` | `three/webgpu`, `three/tsl` |
- **Verify visually, not by reading code.** `renderer.info.render.calls` / `.triangles` give
  draw calls and triangles per frame. Accessibility snapshots (Playwright MCP default) carry no
  canvas pixels: take a real screenshot. Headless Chrome without a GPU needs
  `--use-gl=angle --use-angle=swiftshader-webgl --enable-unsafe-swiftshader` for WebGL.
- **Optional third-party tools** (none official): `threejs-devtools-mcp` (live scene inspector,
  69 tools, WebSocket bridge into a browser tab); `cloudai-x/threejs-skills` (13 Claude Code skill
  files, pinned to r186). Context7 indexes `mrdoob/three.js`.

## 2. iPhone and the Expo WebView

- WebKit has WebGL 2 on Metal since Safari 15; import maps since Safari 16.4 (iOS 16).
- **Pixel ratio is the biggest single cost.** Maintainer: full `devicePixelRatio` "can kill
  performance" even for simple scenes (s, 2018; a user measured 40 vs 60 fps). Clamp to 2, or
  step up adaptively 1 → 1.25 → 1.5 while the frame rate holds (s, 2026-11-06).
- Draw calls: a few hundred at most, 1000 as the ceiling (s, react-three-fiber docs).
- Drive the loop with `renderer.setAnimationLoop`; `setAnimationLoop(null)` pauses it. A
  never-stopping loop is the main battery drain: render on demand when the pet rests (s).
- `antialias` is a constructor option: decide it once.
- The WKWebView content process lives outside the app's memory and iOS can kill it on its own:
  handle `onContentProcessDidTerminate` and reload the WebView.
- The bridge: `window.ReactNativeWebView.postMessage` exists only when `onMessage` is set, and it
  takes one string (JSON-encode). `source={{ html, baseUrl }}`: relative URLs resolve against
  `baseUrl`, which is how the page reaches the LAN API server; the docs name a local web server
  as the workaround for local assets.
- `expo-gl` (used by `@react-three/fiber/native`) has an incomplete WebGL 2 and no argument
  checks, so bad arguments can crash natively. This backs the WebView choice.
- Context loss: iOS 17.0 had a WebKit-level WebGL regression, fixed in 17.1.1 (s). Reuse
  geometries and materials and keep textures small to avoid memory-driven loss (s).

## 3. Building the beaver and making it alive

- **MeshMatcapMaterial** bakes colour and shading into one texture and ignores lights: the
  cheapest route to a glossy vinyl look. It casts but never receives shadows, so the pet needs a
  separate ground shadow.
- **MeshToonMaterial** banding comes from `gradientMap`, which needs `NearestFilter` for both
  min and mag filters.
- **Contact shadows:** the official `webgl_shadow_contact` example renders depth from below into
  512×512 targets and blurs it in two passes, twice per frame. On a phone a static blurred blob
  texture under the pet is the cheaper route (our inference; no cost numbers were found).
- **Shapes:** `CapsuleGeometry(radius, height, capSegments, radialSegments)`: `height` is the
  middle section only. `LatheGeometry(points, segments)` revolves a profile around Y (all
  `x > 0`): good for a pear-shaped body or head.
- **Outlines:** `OutlinePass` needs EffectComposer and extra render targets; `OutlineEffect` is
  WebGL-only and replaces the render call. On a phone prefer an inverted-hull shell (not sourced).
- **Rim light:** inject a fresnel term through `onBeforeCompile` with a view direction varying
  (s, forum code).
- **Motion:** maath now ships `spring.update(state, target, smoothTime, dampingRatio, delta)` and
  `spring.damp`; GSAP's default ease is `power1.out`, with back, bounce and elastic available.
- **Voxels from a painting:** `InstancedMesh` draws all cubes in one call; set colours with
  `setColorAt` then `instanceColor.needsUpdate = true`; count only non-transparent pixels first
  and allocate exactly that many instances (s).

## 4. Workflow from the DesignCode video (added at the owner's request)

Source: "How I Build Insane Three.js Websites With Claude Opus 5", DesignCode (Meng To),
https://youtu.be/G-F5Qvy-7KM, 40 min, published 2026-08-13. Full transcript:
`video-designcode-transcript.txt`. This is one practitioner's workflow, not measured evidence.

- **Reference first, one short prompt.** Give the agent a reference URL or video and the
  prompt "Recreate this in a single HTML file. Self-verify until it's perfect." Long
  hand-written descriptions come later, when you change the style.
- **Small single-file studies.** Keep a folder of quick HTML experiments instead of building the
  whole site each time; vague, oversized asks produce the generic "AI slop" look.
- **The agent needs a browser.** The desktop app's browser lets it watch motion and scroll on
  the reference, record and dissect frames (Playwright), and test its own result.
- **High effort for design.** He runs design work at extra-high effort: lower effort researches
  less and gives up sooner. Runs take 30-45 minutes and cost more tokens.
- **Then mold it into your own.** The first version is a study; his final Kage page keeps about
  10% of the reference. Push with concrete vocabulary: "make it 3D in three.js", "orbit",
  "parallax", "transparent layers in front", "falling leaves", "wisps", "scene transitions".
- **Textures and depth from generated images.** He generates textures and transparent PNG
  layers with Higgsfield (the same MCP we have) and asks the agent to art-direct with options.
- **Prototype options before committing:** ask for variants of typography, colour, layout, then
  make the chosen one permanent.
- **Save what works as skills** (textures, weather, time of day, orbit) so it is repeatable.
- **Study source:** his three.js projects are public on GitHub: `MengTo/kage` (Kyoto temple night
  walk, under 1 MB, tested on mobile), `MengTo/towers`, `MengTo/sketchbook`. None of the three has
  a licence on GitHub (checked 2026-11-14), so read them for technique and do not copy code.
- Mentioned tools: canvasui.dev (copy-paste shader effects as prompts), skills.sh (skill
  directory), Mobbin MCP (UI references).

What this changes for us: build the beaver as a single-file study first, with the Gemini sheet
as the reference, self-verify by screenshot, then port it into the WebView.

## Not found (test it ourselves)

Bloom, MSAA and shadow-map cost on iPhone GPUs; WKWebView WebGL memory and texture limits;
`<script type="module">` with import maps under `react-native-webview` `baseUrl`; a WebView vs
`expo-gl` benchmark; sourced recipes for squash and stretch, breathing, blinking and pointer
tracking; a jelly look without `transmission`; inverted-hull outline docs.
