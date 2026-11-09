export function VouchMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="#0f172a" />
      <path d="M32 12 L50 19 V31 C50 42 42 50 32 53 C22 50 14 42 14 31 V19 Z" fill="#10b981" />
      <path d="M23 32 L29.5 38.5 L42 26" stroke="#0f172a" strokeWidth="5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function VouchWordmark() {
  return (
    <span className="flex items-center gap-2">
      <VouchMark />
      <span className="text-xl font-bold tracking-tight">Vouch</span>
    </span>
  );
}
