interface AvatarProps {
  src?: string | null;
  name: string;
  size?: number;
  className?: string;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0] ?? '')
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function getColorFromName(name: string): string {
  // Deterministic color from name hash
  const colors = [
    '#ea580c',
    '#16a34a',
    '#2563eb',
    '#7c3aed',
    '#db2777',
    '#0891b2',
    '#ca8a04',
    '#dc2626',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length] ?? colors[0]!;
}

export function Avatar({ src, name, size = 36, className = '' }: AvatarProps) {
  const initials = getInitials(name);
  const color = getColorFromName(name);

  if (src) {
    return (
      <img
        src={src}
        alt={name}
        width={size}
        height={size}
        className={`avatar flex-shrink-0 ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <div
      className={`avatar flex flex-shrink-0 items-center justify-center font-semibold text-white ${className}`}
      style={{ width: size, height: size, backgroundColor: color, fontSize: size * 0.38 }}
      aria-label={name}
      role="img"
    >
      {initials}
    </div>
  );
}
