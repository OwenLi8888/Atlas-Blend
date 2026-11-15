/** Downloads a painting as a PNG: the picture on a cream mat in its wood frame, with its plaque. */
export async function savePainting(painting: { imageUrl: string; title: string; style: string }, byline: string): Promise<void> {
  const img = new Image();
  img.src = painting.imageUrl;
  try {
    await img.decode();
  } catch {
    return;
  }
  const css = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const serif = token('--serif', 'Georgia, serif');
  const sans = token('--sans', 'system-ui, sans-serif');
  const navy = token('--navy', '#142f40');
  await Promise.all([document.fonts.load(`400 56px ${serif}`), document.fonts.load(`600 24px ${sans}`)]).catch(() => {});

  const W = 1200, margin = 90, wood = 14, mat = 40;
  const artW = W - 2 * (margin + wood + mat);
  const artH = Math.round((artW * img.naturalHeight) / img.naturalWidth);
  const frameH = artH + 2 * (wood + mat);
  const plaqueH = byline ? 230 : 180;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = margin + frameH + plaqueH + margin / 2;
  const g = canvas.getContext('2d');
  if (!g) return;
  g.fillStyle = token('--ivory', '#e7decd');
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = '#b98a5c';
  g.fillRect(margin, margin, W - 2 * margin, frameH);
  g.fillStyle = '#f4efe6';
  g.fillRect(margin + wood, margin + wood, W - 2 * (margin + wood), frameH - 2 * wood);
  g.drawImage(img, margin + wood + mat, margin + wood + mat, artW, artH);

  g.textAlign = 'center';
  let y = margin + frameH + 86;
  g.fillStyle = navy;
  g.font = `400 56px ${serif}`;
  g.fillText(painting.title, W / 2, y, W - 2 * margin);
  y += 50;
  g.fillStyle = token('--olive', '#393a10');
  g.font = `600 22px ${sans}`;
  g.fillText(painting.style.toUpperCase().split('').join(' '), W / 2, y);
  if (byline) {
    y += 48;
    g.fillStyle = navy;
    g.globalAlpha = 0.68;
    g.font = `400 28px ${sans}`;
    g.fillText(byline, W / 2, y);
    g.globalAlpha = 1;
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${painting.title.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'our-painting'}.png`;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
