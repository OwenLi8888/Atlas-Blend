/** Small grid variants; larger same-origin images also supply the painting canvas. */
export const thumbnailUrl = (id: string) => '/api/image?id=' + encodeURIComponent(id) + '&width=480';
export const revealUrl = (id: string) => '/api/image?id=' + encodeURIComponent(id) + '&width=1280';
