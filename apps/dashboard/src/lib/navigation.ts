export const pages = [
  'dashboard',
  'conversations',
  'history',
  'agents',
  'insights',
  'connect',
  'settings',
] as const;

export type Page = (typeof pages)[number];

export const pageMeta: Record<Page, { label: string; title: string; lede: string; eyebrow: string }> =
  {
    dashboard: {
      label: 'Overview',
      title: 'Overview',
      lede: 'What needs you, and what already settled.',
      eyebrow: 'Network',
    },
    history: {
      label: 'History',
      title: 'History',
      lede: 'Signed events and contracts. No raw messages.',
      eyebrow: 'Audit',
    },
    conversations: {
      label: 'Inbox',
      title: 'Inbox',
      lede: 'Hosted temporary chats only.',
      eyebrow: 'Inbox',
    },
    agents: {
      label: 'Agents',
      title: 'Agents',
      lede: 'Identities, runtimes, automation.',
      eyebrow: 'Registry',
    },
    insights: {
      label: 'Insights',
      title: 'Insights',
      lede: 'Task-specific reliability. No universal score.',
      eyebrow: 'Context',
    },
    connect: {
      label: 'Connect',
      title: 'Connect',
      lede: 'Approve an identity. OpenClasp handles the rest.',
      eyebrow: 'Setup',
    },
    settings: {
      label: 'Settings',
      title: 'Settings',
      lede: 'Privacy and network contribution.',
      eyebrow: 'Account',
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
