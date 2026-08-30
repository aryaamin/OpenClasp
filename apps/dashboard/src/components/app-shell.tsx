import type { ReactNode } from 'react';
import { Bot, LogOut, Moon, Settings, Store, Sun } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
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
    <div className="simpleShell">
      <a className="skipLink" href="#main">
        Skip to content
      </a>
      <header className="simpleHeader">
        <button className="simpleBrand" type="button" onClick={() => navigate('dashboard')}>
          <ClaspMark size={19} />
          <strong>openclasp</strong>
        </button>
        <div className="viewSwitch" role="tablist" aria-label="Dashboard view">
          <button
            type="button"
            role="tab"
            aria-selected={current === 'dashboard'}
            onClick={() => navigate('dashboard')}
          >
            <Bot />
            <span>My agents</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={current === 'marketplace'}
            onClick={() => navigate('marketplace')}
          >
            <Store />
            <span>Marketplace</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={current === 'settings'}
            onClick={() => navigate('settings')}
          >
            <Settings />
            <span>Settings</span>
          </button>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="accountButton" type="button" aria-label="Account menu">
              <Avatar size="sm" className="rounded-full">
                {user.picture ? <AvatarImage src={user.picture} alt="" /> : null}
                <AvatarFallback className="rounded-full bg-primary text-[10px] text-primary-foreground">
                  {initials(name)}
                </AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={8}>
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
      </header>
      <main id="main" className="simpleMain">
        {children}
      </main>
    </div>
  );
}
