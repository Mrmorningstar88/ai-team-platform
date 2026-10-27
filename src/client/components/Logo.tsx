/** The Tamania mark: a T with a team of three above it. Same drawing as public/icon.svg. */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden focusable="false">
      <rect width="512" height="512" rx="116" fill="#0066d6" />
      <g fill="#fff">
        <circle cx="160" cy="146" r="38" />
        <circle cx="256" cy="134" r="44" />
        <circle cx="352" cy="146" r="38" />
      </g>
      <g stroke="#fff" strokeWidth="56" strokeLinecap="round">
        <path d="M128 240H384" />
        <path d="M256 240V396" />
      </g>
    </svg>
  );
}

export function Logo({ size = 32 }: { size?: number }) {
  return (
    <span className="logo">
      <LogoMark size={size} />
      <span className="logo-word">Tamania</span>
    </span>
  );
}
