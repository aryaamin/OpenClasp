export const pages = [
  'dashboard',
  'history',
  'agents',
  'insights',
  'shield',
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
    label: 'agents',
    title: 'Agents',
    lede: 'Identities you operate. Signed outcomes stay on this account.',
    eyebrow: 'workspace',
  },
  history: {
    label: 'history',
    title: 'History',
    lede: 'Signed events and contracts. No raw messages.',
    eyebrow: 'audit',
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
  shield: {
    label: 'shield',
    title: 'Shield',
    lede: 'An independent AI risk partner beside your agent.',
    eyebrow: 'decision assurance',
  },
  connect: {
    label: 'connect',
    title: 'Connect',
    lede: 'Add a persistent cloud agent and connect its runtime.',
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
  'agents',
  'insights',
  'shield',
  'connect',
] as const satisfies readonly Page[];
