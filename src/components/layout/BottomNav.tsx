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
      <div className="flex items-stretch justify-around max-w-screen-md mx-auto">
        {navItems.map(({ to, icon: Icon, label, exact }) => {
          const isActive = exact ? location.pathname === to : location.pathname.startsWith(to);
          return (
            <NavLink
              key={to}
              to={to}
              className={`flex flex-col items-center gap-1 px-3 py-2.5 flex-1 min-h-[56px] justify-center transition-colors ${
                isActive
                  ? 'text-[rgb(var(--color-accent))]'
                  : 'text-muted hover:text-secondary'
              }`}
              aria-label={label}
              aria-current={isActive ? 'page' : undefined}
            >
              <Icon
                size={22}
                strokeWidth={isActive ? 2.5 : 1.75}
              />
              <span className={`text-[10px] font-medium ${
                isActive ? 'font-semibold' : ''
              }`}>
                {label}
              </span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
