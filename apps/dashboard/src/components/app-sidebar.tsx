import {
  BarChart3,
  History,
  LayoutDashboard,
  LogOut,
  Moon,
  Plus,
  ScanLine,
  Settings,
  Sun,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
  useSidebar,
} from '@/components/ui/sidebar';
import { ClaspMark } from '@/components/clasp-mark';
import { pageMeta, primaryNav, type Page } from '@/lib/navigation';
import { initials } from '@/lib/utils';

const navIcons = {
  dashboard: LayoutDashboard,
  history: History,
  agents: ScanLine,
  insights: BarChart3,
  connect: Plus,
  settings: Settings,
} as const;

export type ShellUser = {
  name?: string;
  email?: string;
  picture?: string;
};

export type NavBadges = {
  dashboard: number;
  connect: number;
};

export function AppSidebar({
  page,
  navigate,
  user,
  theme,
  onToggleTheme,
  onSignOut,
  badges,
}: {
  page: Page;
  navigate: (page: Page) => void;
  user: ShellUser;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onSignOut: () => void;
  badges: NavBadges;
}) {
  const { setOpenMobile } = useSidebar();
  const go = (next: Page) => {
    navigate(next);
    setOpenMobile(false);
  };
  const name = user.name || 'OpenClasp user';
  const email = user.email || 'Signed in';

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" tooltip="OpenClasp" onClick={() => go('dashboard')}>
              <ClaspMark className="sidebarBrandMark" size={18} />
              <span className="sidebarBrandText">
                <strong>openclasp</strong>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {primaryNav.map((item) => {
                const Icon = navIcons[item];
                const count = item in badges ? badges[item as keyof NavBadges] : 0;
                return (
                  <SidebarMenuItem key={item}>
                    <SidebarMenuButton
                      isActive={page === item}
                      tooltip={pageMeta[item].label}
                      onClick={() => go(item)}
                    >
                      <Icon />
                      <span>{pageMeta[item].label}</span>
                    </SidebarMenuButton>
                    {count > 0 ? <SidebarMenuBadge>{count}</SidebarMenuBadge> : null}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarSeparator />
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={page === 'settings'}
                  tooltip="settings"
                  onClick={() => go('settings')}
                >
                  <Settings />
                  <span>settings</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
                  <Avatar size="sm" className="rounded-none">
                    {user.picture ? <AvatarImage src={user.picture} alt="" /> : null}
                    <AvatarFallback className="rounded-none bg-primary text-[10px] font-medium text-primary-foreground">
                      {initials(name)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="grid min-w-0 flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{name}</span>
                    <span className="truncate text-[11px] text-muted-foreground">{email}</span>
                  </span>
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="min-w-56" side="top" align="start" sideOffset={6}>
                <DropdownMenuItem onClick={onToggleTheme}>
                  {theme === 'dark' ? <Sun /> : <Moon />}
                  {theme === 'dark' ? 'Light theme' : 'Dark theme'}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => go('settings')}>
                  <Settings />
                  Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={onSignOut}>
                  <LogOut />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
