export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function svgToPngBlob(svg, scale = 2) {
  if (typeof svg !== 'string' || !svg.trim()) throw new TypeError('A valid SVG is required.');
  if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0)
    throw new RangeError('Scale must be a positive number.');
  const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
  if (root.localName !== 'svg' || root.querySelector('parsererror')) throw new TypeError('Invalid SVG.');
  const width = Math.max(1, Math.round(Number(root.getAttribute('width')) * scale));
  const height = Math.max(1, Math.round(Number(root.getAttribute('height')) * scale));
  if (
    ![width, height].every(Number.isSafeInteger) ||
    width > 32768 ||
    height > 32768 ||
    width * height > 40_000_000
  )
    throw new RangeError('Image size exceeds the limit: 32768 px per side and 40 million pixels total.');
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser could not create a PNG canvas.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return await new Promise((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('PNG conversion failed. Please retry.'))),
        'image/png',
      ),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
