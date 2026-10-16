type LogoProps = {
  size?: number;
  /** Background the mark sits on; the gaps around the stripe are painted in this colour. */
  background?: string;
  className?: string;
};

/**
 * The H_CHAT mark: the original Chat logo from omranisystems.com, recoloured dark burgundy.
 * The viewBox is centred on the ring (60,60) so the mark sits visually centred.
 */
export function Logo({ size = 64, background = "#0A0B10", className }: LogoProps) {
  return (
    <svg viewBox="-4 -4 128 128" width={size} height={size} aria-hidden="true" className={className}>
      <circle cx="60" cy="60" r="46" fill="none" stroke="#FFFFFF" strokeWidth="9" />
      <path
        d="M116 32H52Q40 32 40 44V48Q40 60 52 60H68Q80 60 80 72V76Q80 88 68 88H4"
        fill="none"
        stroke={background}
        strokeWidth="21"
      />
      <path
        d="M102 32H52Q40 32 40 44V48Q40 60 52 60H68Q80 60 80 72V76Q80 88 68 88H18"
        fill="none"
        stroke="#8C2A3F"
        strokeWidth="11"
      />
      <circle cx="100" cy="100" r="19" fill="#6E1B2B" stroke={background} strokeWidth="5" />
      <path
        d="M89 92Q89 88 93 88H107Q111 88 111 92V102Q111 106 107 106H98L92 111V106H93Q89 106 89 102Z"
        fill="#FFFFFF"
      />
      <path d="M94 94H106M94 99H102" fill="none" stroke="#6E1B2B" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-mono font-bold ${className}`}>
      H<span className="text-accent">_</span>CHAT
    </span>
  );
}
