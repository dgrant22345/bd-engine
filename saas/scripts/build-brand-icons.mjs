// Regenerates the public favicon and touch-icon set from the brand mark.
// Renders with the self-hosted Inter file so output does not depend on fonts
// installed on the build machine.
//   node scripts/build-brand-icons.mjs
/* global document */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const publicDir = new URL('../public/', import.meta.url);
const font = (await readFile(new URL('fonts/inter-latin-wght-normal.woff2', publicDir))).toString('base64');

// The 48-unit artboard matches public/brand-mark.svg. Small sizes use a larger
// monogram and tighter corners so "BD" stays legible in a browser tab.
function markSvg({ size, radius, fontSize, baseline, scale = 1 }) {
  const inset = (48 - 48 * scale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="${size}" height="${size}">
    <defs><linearGradient id="teal" x2="1" y2="1"><stop stop-color="#36b7a6"/><stop offset="1" stop-color="#117c76"/></linearGradient></defs>
    <rect width="48" height="48" rx="${radius}" fill="url(#teal)"/>
    <g transform="translate(${inset} ${inset}) scale(${scale})">
      <text x="24" y="${baseline}" text-anchor="middle" fill="#fff" font-family="BD Icon Inter" font-weight="800" font-size="${fontSize}" letter-spacing="-1">BD</text>
    </g>
  </svg>`;
}

const variants = {
  // Tab-sized: bold monogram, modest radius.
  small: { radius: 10, fontSize: 25, baseline: 33 },
  // Large rounded mark, same proportions as the in-page logo.
  rounded: { radius: 13, fontSize: 19, baseline: 30.8 },
  // Full bleed for platforms that apply their own mask (iOS home screen).
  bleed: { radius: 0, fontSize: 19, baseline: 30.8, scale: 0.86 },
};

const outputs = [
  { file: 'icon-16.png', size: 16, variant: 'small', keep: false },
  { file: 'icon-32.png', size: 32, variant: 'small', keep: false },
  { file: 'icon-48.png', size: 48, variant: 'small', keep: false },
  { file: 'icon-192.png', size: 192, variant: 'rounded', keep: true },
  { file: 'apple-touch-icon.png', size: 180, variant: 'bleed', keep: true },
];

function buildIco(images) {
  // ICO container with PNG-encoded entries (supported by every current browser).
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const directory = Buffer.alloc(16 * images.length);
  let offset = header.length + directory.length;
  images.forEach(({ size, data }, index) => {
    const entry = index * 16;
    directory.writeUInt8(size >= 256 ? 0 : size, entry);
    directory.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    directory.writeUInt8(0, entry + 2);
    directory.writeUInt8(0, entry + 3);
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(data.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([header, directory, ...images.map(({ data }) => data)]);
}

const browser = await chromium.launch();
try {
  const rendered = new Map();
  for (const { file, size, variant, keep } of outputs) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><style>
      @font-face { font-family: "BD Icon Inter"; font-weight: 100 900; src: url(data:font/woff2;base64,${font}) format("woff2"); }
      html, body { margin: 0; background: transparent; }
      svg { display: block; }
    </style>${markSvg({ size, ...variants[variant] })}`);
    await page.evaluate(() => document.fonts.load('800 19px "BD Icon Inter"', 'BD'));
    await page.evaluate(() => document.fonts.ready);
    const data = await page.screenshot({ omitBackground: variant !== 'bleed', type: 'png' });
    rendered.set(file, { size, data });
    if (keep) await writeFile(fileURLToPath(new URL(file, publicDir)), data);
    await page.close();
  }
  const ico = buildIco(['icon-16.png', 'icon-32.png', 'icon-48.png'].map((file) => rendered.get(file)));
  await writeFile(fileURLToPath(new URL('favicon.ico', publicDir)), ico);
  console.log(`Wrote favicon.ico (${ico.length} bytes) and ${outputs.filter((entry) => entry.keep).length} PNG icons.`);
} finally {
  await browser.close();
}
