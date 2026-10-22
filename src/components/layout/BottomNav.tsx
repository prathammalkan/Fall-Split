import { NavLink, useLocation } from 'react-router-dom';
import { Home, Users, Layers, Activity, User } from 'lucide-react';

const navItems = [
  { to: '/', icon: Home, label: 'Home', exact: true },
  { to: '/friends', icon: Users, label: 'Friends', exact: false },
  { to: '/groups', icon: Layers, label: 'Groups', exact: false },
  { to: '/activity', icon: Activity, label: 'Activity', exact: false },
  { to: '/profile', icon: User, label: 'Profile', exact: false },
] as const;

export function BottomNav() {
  const location = useLocation();

  return (
    <nav className="bottom-nav" aria-label="Main navigation">
      <div className="mx-auto flex max-w-screen-md items-stretch justify-around">
        {navItems.map(({ to, icon: Icon, label, exact }) => {
          const isActive = exact ? location.pathname === to : location.pathname.startsWith(to);
          return (
            <NavLink
              key={to}
              to={to}
              className={`flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 px-3 py-2.5 transition-colors ${
                isActive ? 'text-[rgb(var(--color-accent))]' : 'text-muted hover:text-secondary'
              }`}
              aria-label={label}
              aria-current={isActive ? 'page' : undefined}
            >
              <Icon size={22} strokeWidth={isActive ? 2.5 : 1.75} />
              <span className={`text-[10px] font-medium ${isActive ? 'font-semibold' : ''}`}>
                {label}
              </span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
