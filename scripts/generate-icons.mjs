// Renders Vouch's shield mark to PNG app icons. Run: node scripts/generate-icons.mjs
import sharp from "sharp";

const mark = (pad) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" ${pad ? "" : 'rx="112"'} fill="#0f172a"/>
  <g transform="translate(256 256) scale(${pad ? 0.62 : 0.8}) translate(-256 -256)">
    <path d="M256 72 L400 128 V248 C400 336 336 400 256 424 C176 400 112 336 112 248 V128 Z" fill="#10b981"/>
    <path d="M184 256 L236 308 L336 208" stroke="#0f172a" stroke-width="40" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`;

const out = [
  ["public/icons/icon-192.png", 192, false],
  ["public/icons/icon-512.png", 512, false],
  ["public/icons/maskable-512.png", 512, true],
  ["public/icons/apple-touch-icon.png", 180, true],
];
for (const [file, size, pad] of out) {
  await sharp(Buffer.from(mark(pad))).resize(size, size).png().toFile(file);
  console.log("wrote", file);
}
await sharp(Buffer.from(mark(false))).resize(48, 48).png().toFile("src/app/icon.png");
console.log("wrote src/app/icon.png");
