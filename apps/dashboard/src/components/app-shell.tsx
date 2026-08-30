import { useEffect, useState, type ReactNode } from 'react';
import { AppSidebar, type NavBadges, type ShellUser } from '@/components/app-sidebar';
import { CommandPalette, CommandTrigger } from '@/components/command-palette';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import type { Page } from '@/lib/navigation';

export function AppShell({
  page,
  navigate,
  user,
  theme,
  onToggleTheme,
  onSignOut,
  badges,
  agents,
  attention,
  children,
}: {
  page: Page;
  navigate: (page: Page) => void;
  user: ShellUser;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onSignOut: () => void;
  badges: NavBadges;
  agents: { agentId: string; name?: string }[];
  attention: { setup: number; invites: number; inbox: number };
  children: ReactNode;
}) {
  const [commandOpen, setCommandOpen] = useState(false);

  useEffect(() => {
    setCommandOpen(false);
  }, [page]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      setCommandOpen((open) => !open);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <SidebarProvider className="min-h-svh">
      <a className="skipLink" href="#main">
        Skip to content
      </a>
      <AppSidebar
        page={page}
        navigate={navigate}
        user={user}
        theme={theme}
        onToggleTheme={onToggleTheme}
        onSignOut={onSignOut}
        badges={badges}
      />
      <SidebarInset id="main" className="appInset">
        <header className="appTopbar">
          <SidebarTrigger className="text-foreground" />
          <CommandTrigger onOpen={() => setCommandOpen(true)} />
        </header>
        <div className="appMain">{children}</div>
      </SidebarInset>
      <CommandPalette
        open={commandOpen}
        onOpenChange={setCommandOpen}
        navigate={navigate}
        theme={theme}
        onToggleTheme={onToggleTheme}
        onSignOut={onSignOut}
        agents={agents}
        attention={attention}
      />
    </SidebarProvider>
  );
}
