import type { ReactNode } from 'react';
import { ArrowRight, LogOut, Moon, Sun } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ShellUser } from '@/components/app-sidebar';
import { ClaspMark } from '@/components/clasp-mark';
import { initials } from '@/lib/utils';
import type { Page } from '@/lib/navigation';

const views = [
  { page: 'dashboard' as const, label: 'agents' },
  { page: 'marketplace' as const, label: 'marketplace' },
  { page: 'settings' as const, label: 'settings' },
];

export function AppShell({
  page,
  navigate,
  user,
  theme,
  onToggleTheme,
  onSignOut,
  children,
}: {
  page: Page;
  navigate: (page: Page) => void;
  user: ShellUser;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onSignOut: () => void;
  badges?: unknown;
  agents?: { agentId: string; name?: string }[];
  attention?: { setup: number; invites: number; inbox: number };
  children: ReactNode;
}) {
  const current = page === 'marketplace' || page === 'settings' ? page : 'dashboard';
  const name = user.name || 'OpenClasp user';

  return (
    <div className="landingPage simpleShell">
      <a className="skipLink" href="#main">
        Skip to content
      </a>
      <header className="landingNav dashHeader">
        <button className="landingBrand" type="button" onClick={() => navigate('dashboard')}>
          <ClaspMark className="landingMark" size={28} />
          <strong>openclasp</strong>
        </button>
        <nav className="dashNav" aria-label="Dashboard">
          {views.map((item) => (
            <button
              key={item.page}
              type="button"
              aria-current={current === item.page ? 'page' : undefined}
              onClick={() => navigate(item.page)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="landingNavActions">
          <button
            className="themeButton"
            type="button"
            onClick={onToggleTheme}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          >
            {theme === 'dark' ? <Sun /> : <Moon />}
          </button>
          <button className="navCta dashCta" type="button" onClick={() => navigate('connect')}>
            add agent <ArrowRight />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="accountMark" type="button" aria-label="Account menu">
                {initials(name)}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={8} className="dashMenu">
              <DropdownMenuItem onClick={onToggleTheme}>
                {theme === 'dark' ? <Sun /> : <Moon />}
                {theme === 'dark' ? 'Light theme' : 'Dark theme'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={onSignOut}>
                <LogOut /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <main id="main" className="simpleMain">
        {children}
      </main>
    </div>
  );
}
