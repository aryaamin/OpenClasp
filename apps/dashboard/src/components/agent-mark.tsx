import { initials } from '@/lib/utils';

export function AgentMark({
  name,
  online,
  size = 'md',
  className,
}: {
  name: string;
  online?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const letters = initials(name) || 'AG';
  return (
    <span
      className={['agentAvatar', size === 'sm' ? 'isSmall' : '', className]
        .filter(Boolean)
        .join(' ')}
      aria-hidden="true"
    >
      <b>{letters}</b>
      {online === undefined ? null : <i className={online ? 'online' : ''} />}
    </span>
  );
}

export function FrameCorners() {
  return (
    <>
      <span className="sceneCorner sceneTL" aria-hidden="true">
        +
      </span>
      <span className="sceneCorner sceneTR" aria-hidden="true">
        +
      </span>
      <span className="sceneCorner sceneBL" aria-hidden="true">
        +
      </span>
    </>
  );
}
