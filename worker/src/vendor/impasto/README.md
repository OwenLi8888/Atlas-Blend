# impasto (vendored)

Stroke planning by [impasto](https://github.com/donghaxkim/impasto) (MIT, Dongha Kim).

These files are an unmodified copy of `sim/src` from that repository at commit
`16b6a7b9c030b8fe01af46be584dd190daa81313`, kept with its `LICENSE`. Magic Brush calls
`planImpasto()` and `strokesToJSON()` from `index.ts` inside a web worker
(`src/workers/plan.worker.ts`).

Why vendored: impasto's README installs the package as a `file:` link to a sibling checkout, which
a Vercel build cannot resolve. Left out, because nothing here needs them: the live viewer and its
GPU ports (`viewer.ts`, `viewer-bundle.ts`, `relight-gpu.ts`, `relight-gl.ts`) and impasto's own
worker (`worker.ts`).

To update: copy the same files from a newer checkout over these and change the commit above.
