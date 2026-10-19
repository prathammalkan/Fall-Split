import type { ReactNode } from 'react';
import { BottomNav } from './BottomNav';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <main className="flex-1">
        {children}
      </main>
      <BottomNav />
    </div>
  );
}
