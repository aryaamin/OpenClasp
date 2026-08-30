import {
  BarChart3,
  Bot,
  History,
  Inbox,
  LayoutDashboard,
  LogOut,
  Moon,
  Plus,
  Settings,
  Sun,
} from 'lucide-react';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@/components/ui/avatar';
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
import { pageMeta, primaryNav, type Page } from '@/lib/navigation';
import { initials } from '@/lib/utils';

const navIcons = {
  dashboard: LayoutDashboard,
  history: History,
  conversations: Inbox,
  agents: Bot,
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
  conversations: number;
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
            <SidebarMenuButton
              size="lg"
              tooltip="OpenClasp"
              onClick={() => go('dashboard')}
            >
              <span className="mark">OC</span>
              <span className="grid min-w-0 text-left leading-tight">
                <span className="truncate font-semibold">OpenClasp</span>
                <span className="truncate text-[11px] text-muted-foreground">
                  Messages stay off-network
                </span>
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
                      className="data-[active=true]:bg-sidebar-primary data-[active=true]:text-sidebar-primary-foreground data-[active=true]:hover:bg-sidebar-primary data-[active=true]:hover:text-sidebar-primary-foreground"
                    >
                      <Icon />
                      <span>{pageMeta[item].label}</span>
                    </SidebarMenuButton>
                    {count > 0 ? (
                      <SidebarMenuBadge className="bg-sidebar-primary text-sidebar-primary-foreground peer-data-[active=true]/menu-button:bg-white peer-data-[active=true]/menu-button:text-sidebar-primary">
                        {count}
                      </SidebarMenuBadge>
                    ) : null}
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
                  tooltip="Settings"
                  onClick={() => go('settings')}
                  className="data-[active=true]:bg-sidebar-primary data-[active=true]:text-sidebar-primary-foreground data-[active=true]:hover:bg-sidebar-primary data-[active=true]:hover:text-sidebar-primary-foreground"
                >
                  <Settings />
                  <span>Settings</span>
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
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent"
                >
                  <Avatar size="sm" className="rounded-lg">
                    {user.picture ? <AvatarImage src={user.picture} alt="" /> : null}
                    <AvatarFallback className="rounded-lg bg-primary text-[10px] font-semibold text-primary-foreground">
                      {initials(name)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="grid min-w-0 flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{name}</span>
                    <span className="truncate text-[11px] text-muted-foreground">{email}</span>
                  </span>
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="min-w-56"
                side="top"
                align="start"
                sideOffset={6}
              >
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
