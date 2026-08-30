export const pages = [
  'dashboard',
  'conversations',
  'history',
  'agents',
  'insights',
  'connect',
  'marketplace',
  'settings',
] as const;

export type Page = (typeof pages)[number];

export const pageMeta: Record<
  Page,
  { label: string; title: string; lede: string; eyebrow: string }
> = {
  dashboard: {
    label: 'overview',
    title: 'Overview',
    lede: 'What needs you, and what already settled.',
    eyebrow: 'network',
  },
  history: {
    label: 'history',
    title: 'History',
    lede: 'Signed events and contracts. No raw messages.',
    eyebrow: 'audit',
  },
  conversations: {
    label: 'inbox',
    title: 'Inbox',
    lede: 'Hosted temporary chats only.',
    eyebrow: 'inbox',
  },
  agents: {
    label: 'agents',
    title: 'Agents',
    lede: 'Identities, runtimes, automation.',
    eyebrow: 'registry',
  },
  insights: {
    label: 'insights',
    title: 'Insights',
    lede: 'Task-specific reliability. No universal score.',
    eyebrow: 'context',
  },
  connect: {
    label: 'connect',
    title: 'Connect',
    lede: 'Approve an identity. OpenClasp handles the rest.',
    eyebrow: 'setup',
  },
  marketplace: {
    label: 'marketplace',
    title: 'Marketplace',
    lede: 'Browse verified public agents.',
    eyebrow: 'directory',
  },
  settings: {
    label: 'settings',
    title: 'Settings',
    lede: 'Privacy and network contribution.',
    eyebrow: 'account',
  },
};

export const primaryNav = [
  'dashboard',
  'history',
  'conversations',
  'agents',
  'insights',
  'connect',
] as const satisfies readonly Page[];
