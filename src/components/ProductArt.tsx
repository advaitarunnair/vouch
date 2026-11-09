import type { ProductArtKind } from "@/lib/shops";

// Hand-drawn SVG product illustrations, so no third-party photos are needed.
export function ProductArt({ kind, className = "" }: { kind: ProductArtKind; className?: string }) {
  if (kind === "scarf") {
    return (
      <svg viewBox="0 0 400 400" className={className} role="img" aria-label="Rust-coloured knitted scarf">
        <rect width="400" height="400" fill="#efe6da" />
        <ellipse cx="200" cy="352" rx="150" ry="14" fill="#d9cbb8" />
        {/* folded scarf lying flat: a loose loop with two fringed tails */}
        <ellipse cx="200" cy="150" rx="105" ry="70" fill="none" stroke="#a8582f" strokeWidth="46" />
        <ellipse cx="200" cy="150" rx="105" ry="70" fill="none" stroke="#8e4523" strokeWidth="46" strokeDasharray="3 9" opacity="0.35" />
        <path d="M150 200 C140 250 120 290 105 318 L160 330 C170 300 185 255 195 210 Z" fill="#b5653a" />
        <path d="M205 210 C220 250 245 290 265 320 L315 300 C290 270 262 235 250 200 Z" fill="#9c4f29" />
        {Array.from({ length: 6 }).map((_, i) => (
          <line key={`a${i}`} x1={108 + i * 9} y1={320 + i * 2} x2={104 + i * 9} y2={340 + i * 2} stroke="#a8582f" strokeWidth="3" strokeLinecap="round" />
        ))}
        {Array.from({ length: 6 }).map((_, i) => (
          <line key={`b${i}`} x1={268 + i * 8} y1={320 - i * 4} x2={274 + i * 8} y2={338 - i * 4} stroke="#9c4f29" strokeWidth="3" strokeLinecap="round" />
        ))}
      </svg>
    );
  }
  if (kind === "mask") {
    return (
      <svg viewBox="0 0 400 400" className={className} role="img" aria-label="White LED face mask glowing red">
        <defs>
          <radialGradient id="glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ff5c8a" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#ff5c8a" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="400" height="400" fill="#f7e3ee" />
        <circle cx="200" cy="200" r="170" fill="url(#glow)" />
        <path d="M200 60 C290 60 320 140 315 210 C310 300 260 345 200 345 C140 345 90 300 85 210 C80 140 110 60 200 60 Z" fill="#fdfbfc" stroke="#e6cfdc" strokeWidth="4" />
        <ellipse cx="155" cy="185" rx="30" ry="16" fill="#3a0f27" />
        <ellipse cx="245" cy="185" rx="30" ry="16" fill="#3a0f27" />
        <path d="M170 280 Q200 295 230 280" stroke="#3a0f27" strokeWidth="10" fill="none" strokeLinecap="round" />
        {[
          [130, 120], [170, 105], [230, 105], [270, 120], [120, 240], [280, 240], [150, 320], [250, 320], [200, 230],
        ].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="7" fill="#ff3d7f" opacity="0.85" />
        ))}
      </svg>
    );
  }
  // earbuds: deliberately generic, "stock photo" look with a sample watermark
  return (
    <svg viewBox="0 0 400 400" className={className} role="img" aria-label="Generic white earbuds on a plain background">
      <rect width="400" height="400" fill="#ffffff" />
      <ellipse cx="200" cy="330" rx="120" ry="12" fill="#e5e5e5" />
      <rect x="120" y="210" width="160" height="110" rx="45" fill="#f2f2f2" stroke="#d4d4d4" strokeWidth="3" />
      <line x1="125" y1="250" x2="275" y2="250" stroke="#d4d4d4" strokeWidth="3" />
      <g transform="translate(150 90) rotate(-15)">
        <ellipse cx="0" cy="0" rx="28" ry="32" fill="#fafafa" stroke="#cfcfcf" strokeWidth="3" />
        <rect x="-8" y="20" width="16" height="70" rx="8" fill="#fafafa" stroke="#cfcfcf" strokeWidth="3" />
      </g>
      <g transform="translate(250 90) rotate(15)">
        <ellipse cx="0" cy="0" rx="28" ry="32" fill="#fafafa" stroke="#cfcfcf" strokeWidth="3" />
        <rect x="-8" y="20" width="16" height="70" rx="8" fill="#fafafa" stroke="#cfcfcf" strokeWidth="3" />
      </g>
      <g opacity="0.13" fontFamily="Arial, sans-serif" fontSize="26" fontWeight="700" fill="#000">
        {[60, 160, 260, 360].map((y) => (
          <text key={y} x="-40" y={y} transform={`rotate(-25 200 ${y})`}>
            SAMPLE IMAGE · SAMPLE IMAGE · SAMPLE IMAGE
          </text>
        ))}
      </g>
    </svg>
  );
}
