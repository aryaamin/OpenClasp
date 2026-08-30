import { useEffect, useState } from 'react';
import {
  BarChart3,
  Bot,
  History,
  Inbox,
  LayoutDashboard,
  LogOut,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';
import { pageMeta, pages, type Page } from '@/lib/navigation';

const pageIcons = {
  dashboard: LayoutDashboard,
  history: History,
  conversations: Inbox,
  agents: Bot,
  insights: BarChart3,
  connect: Plus,
  settings: Settings,
} as const;

export function CommandPalette({
  open,
  onOpenChange,
  navigate,
  theme,
  onToggleTheme,
  onSignOut,
  agents,
  attention,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  navigate: (page: Page) => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onSignOut: () => void;
  agents: { agentId: string; name?: string }[];
  attention: { setup: number; invites: number; inbox: number };
}) {
  const go = (page: Page) => {
    onOpenChange(false);
    navigate(page);
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Jump to"
      description="Search pages, agents, and actions"
      className="bg-popover"
    >
      <CommandInput placeholder="Go to a page, agent, or action…" />
      <CommandList>
        <CommandEmpty>Nothing matches.</CommandEmpty>
        {attention.setup + attention.invites + attention.inbox > 0 ? (
          <CommandGroup heading="Needs you">
            {attention.setup > 0 ? (
              <CommandItem onSelect={() => go('connect')}>
                <Plus />
                Pending setup
                <CommandShortcut>{attention.setup}</CommandShortcut>
              </CommandItem>
            ) : null}
            {attention.invites > 0 ? (
              <CommandItem onSelect={() => go('dashboard')}>
                <LayoutDashboard />
                Pending invites
                <CommandShortcut>{attention.invites}</CommandShortcut>
              </CommandItem>
            ) : null}
            {attention.inbox > 0 ? (
              <CommandItem onSelect={() => go('conversations')}>
                <Inbox />
                Unread inbox
                <CommandShortcut>{attention.inbox}</CommandShortcut>
              </CommandItem>
            ) : null}
          </CommandGroup>
        ) : null}
        <CommandGroup heading="Pages">
          {pages.map((page) => {
            const Icon = pageIcons[page];
            return (
              <CommandItem key={page} value={pageMeta[page].label} onSelect={() => go(page)}>
                <Icon />
                {pageMeta[page].label}
              </CommandItem>
            );
          })}
        </CommandGroup>
        {agents.length ? (
          <CommandGroup heading="Agents">
            {agents.map((agent) => (
              <CommandItem
                key={agent.agentId}
                value={`${agent.name ?? ''} ${agent.agentId}`}
                onSelect={() => go('agents')}
              >
                <Bot />
                {agent.name || agent.agentId}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        <CommandSeparator />
        <CommandGroup heading="Account">
          <CommandItem
            onSelect={() => {
              onToggleTheme();
              onOpenChange(false);
            }}
          >
            {theme === 'dark' ? <Sun /> : <Moon />}
            {theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
          </CommandItem>
          <CommandItem
            onSelect={() => {
              onOpenChange(false);
              onSignOut();
            }}
          >
            <LogOut />
            Sign out
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

export function CommandTrigger({ onOpen }: { onOpen: () => void }) {
  const [mod, setMod] = useState('Ctrl');
  useEffect(() => {
    setMod(navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl');
  }, []);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onOpen}
      className="commandTrigger text-muted-foreground h-8 max-w-xs flex-1 justify-start border-border bg-transparent px-2 shadow-none hover:bg-sidebar-accent sm:min-w-[220px]"
    >
      <Search />
      <span className="flex-1 text-left">Search</span>
      <kbd className="commandKbd">
        {mod}
        {mod === '⌘' ? '' : '+'}K
      </kbd>
    </Button>
  );
}
