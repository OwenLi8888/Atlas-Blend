/** One picture on the gallery wall. */
export interface GalleryPicture {
  /** Image address: a file, a same-origin API image or a data URL. */
  src: string;
  /** Width / height, if known before the image loads. */
  aspect?: number;
}

export interface GalleryScene {
  /** Move to picture `index`. */
  go(index: number): void;
  /** Move `delta` pictures along (1 = next, -1 = previous). */
  step(delta: number): void;
  dispose(): void;
}

export function createGalleryScene(
  canvas: HTMLCanvasElement,
  options: {
    /** Where the studio's painted props are, e.g. './studio/'. */
    base: string;
    items: GalleryPicture[];
    /** The picture the camera is now nearest to. */
    onIndex?: (index: number) => void;
    reducedMotion?: boolean;
  },
): GalleryScene;
