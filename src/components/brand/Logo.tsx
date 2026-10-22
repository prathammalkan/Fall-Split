interface LogoProps {
  size?: number;
  className?: string;
  showText?: boolean;
}

export function Logo({ size = 32, className = '', showText = false }: LogoProps) {
  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      {/* Geometric angular split icon */}
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="Fall Split logo"
        role="img"
      >
        {/* Angular lightning bolt / split shape */}
        <path d="M18 2L4 18H14L14 30L28 14H18L18 2Z" fill="rgb(249 115 22)" stroke="none" />
        {/* Sharp accent line */}
        <path
          d="M22 8L28 14"
          stroke="rgb(249 115 22)"
          strokeWidth="2.5"
          strokeLinecap="square"
          opacity="0.4"
        />
      </svg>
      {showText && (
        <span className="logo-text text-xl">
          Fall<span className="logo-accent"> Split</span>
        </span>
      )}
    </div>
  );
}

export function LogoFull({ className = '' }: { className?: string }) {
  return <Logo size={28} className={className} showText />;
}
