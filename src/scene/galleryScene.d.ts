/** One picture on the gallery wall. */
export interface GalleryPicture {
  /** Image address: a file, a same-origin API image or a data URL. */
  src: string;
  /** Width / height, if known before the image loads. */
  aspect?: number;
}

/** A named part of the hang: its title is lettered on the wall above picture `at`. */
export interface GallerySection {
  title: string;
  /** Index of the section's first picture. */
  at: number;
}

export interface GalleryScene {
  /** Move to picture `index`. */
  go(index: number): void;
  /** Move `delta` pictures along (1 = next, -1 = previous). */
  step(delta: number): void;
  /** Bring the camera in on the picture in front while it is being read about, or step back. */
  focus(on: boolean): void;
  dispose(): void;
}

export function createGalleryScene(
  canvas: HTMLCanvasElement,
  options: {
    items: GalleryPicture[];
    sections?: GallerySection[];
    /** The picture the camera is now nearest to. */
    onIndex?: (index: number) => void;
    /** The picture in front was tapped. */
    onTap?: (index: number) => void;
    reducedMotion?: boolean;
  },
): GalleryScene;
