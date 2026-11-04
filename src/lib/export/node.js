import { writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const MAX_DIMENSION = 32768;
const MAX_PIXELS = 40_000_000;

export async function exportSvg(svgContent, outputPath) {
  if (typeof svgContent !== 'string') throw new TypeError('svgContent must be a string');
  await writeFile(outputPath, svgContent, 'utf8');
}

/** Rasterize at target density and round to exact output pixel dimensions. */
export async function exportPng(svgContent, outputPath, options = {}) {
  if (typeof svgContent !== 'string' || !svgContent.trim()) throw new TypeError('svgContent must be a non-empty SVG string');
  if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => key !== 'scale')) throw new TypeError('Only the scale option is supported');
  const scale = Object.hasOwn(options, 'scale') ? options.scale : 1;
  if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0) throw new RangeError('scale must be a finite positive number');
  const input = Buffer.from(svgContent, 'utf8');
  const metadata = await sharp(input, { limitInputPixels: MAX_PIXELS }).metadata();
  if (metadata.format !== 'svg') throw new TypeError('Expected SVG input');
  const width = Math.max(1, Math.round(metadata.width * scale));
  const height = Math.max(1, Math.round(metadata.height * scale));
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS) throw new RangeError(`PNG size exceeds limits (${MAX_DIMENSION}px per side, ${MAX_PIXELS} pixels)`);
  const density = Math.min(100000, Math.max(1, 72 * scale));
  await sharp(input, { density, limitInputPixels: MAX_PIXELS })
    .resize(width, height, { fit: 'fill' })
    .flatten({ background: '#ffffff' }).png().toFile(outputPath);
}
