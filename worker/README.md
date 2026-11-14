# Painting worker (Node)

Corrected still -> stroke plan -> brush render -> frames -> MP4 (M8).

* **Planner**: layered curved strokes, coarse to fine (radii 20/10/5/2.5 px at 512), each stroke
  starts at the worst-error pixel of its grid cell and follows the image's isophotes.
  Set `PAINT_ENGINE=<package>` to use the team's existing stroke engine instead (it must
  export `planStrokes(img) -> {width,height,layers,strokes}`); it is loaded as a dependency,
  never copied in.
* **Brush sets**: `oil` (bristle ridges + impasto highlight), `watercolor` (layered translucent
  washes, wet edge), `ink` (wash for big shapes, tapered line work for detail), `gouache`
  (opaque matte), `pastel` (grainy dabs, paper tooth shows).
* **Video**: per-layer frame budget so big shapes get screen time, a light finishing glaze
  (`PAINT_GLAZE`, default 25%) so the last frame lands on the still, 1.5 s hold, raw RGBA piped
  into ffmpeg (`ffmpeg-static`), H.264 yuv420p faststart. ~11 s at 30 fps.

Spike result on a 640 px still: 1.8 to 4.3 s per render (budget: 40 s).

```
npx tsx src/cli.ts --still still.png --out out/ --brush watercolor
```
