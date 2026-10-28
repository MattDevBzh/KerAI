import { useEffect, useId, useState, type ImgHTMLAttributes } from 'react';
import { Bot } from 'lucide-react';
import type { AgentProfile, StepStatus } from '../src/shared/types';
import { resolveAvatar } from '../src/shared/avatars';
import { dragonBallPortrait } from '../src/shared/dragonBall';
import { useThemeAppearance } from './ThemePicker';
export { avatarOptions } from '../src/shared/avatars';
export type AvatarPose = 'idle.png' | 'working.gif' | 'approved.png';

/** Shared by every portrait surface; missing seasonal art falls back to the original. */
export function AgentImage({
  avatar,
  agentId,
  pose = 'idle.png',
  ...props
}: Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onError'> & {
  avatar?: string;
  agentId?: string;
  pose?: AvatarPose;
}) {
  const { avatarPack } = useThemeAppearance();
  const clipId = useId();
  const id = resolveAvatar(avatar, agentId);
  const base = `${import.meta.env.BASE_URL}avatars/${id}/${pose}`;
  const portrait = avatarPack === 'dragonball' ? dragonBallPortrait(id, pose) : undefined;
  const primary = portrait
    ? `${import.meta.env.BASE_URL}avatar-events/dragonball/team-${portrait.sheet}.png`
    : avatarPack
      ? `${import.meta.env.BASE_URL}avatar-events/${avatarPack}/${id}/${pose}`
      : base;
  const [failed, setFailed] = useState<string[]>([]);
  useEffect(() => setFailed([]), [primary]);
  useEffect(() => {
    if (!portrait) return;
    // SVG images inside a closed disclosure do not reliably emit resource errors.
    // The HTML image loader shares the atlas cache and keeps fallback independent of visibility.
    const probe = new Image();
    probe.onerror = () =>
      setFailed((paths) => (paths.includes(primary) ? paths : [...paths, primary]));
    probe.src = primary;
    return () => {
      probe.onerror = null;
    };
  }, [primary, Boolean(portrait)]);
  const src = [primary, base].find((path) => !failed.includes(path));
  if (portrait && src === primary)
    return (
      <svg
        className={props.className}
        style={props.style}
        width={props.width ?? '100%'}
        height={props.height ?? '100%'}
        data-agent-art="dragonball"
        data-avatar={id}
        data-pose={pose}
        viewBox={portrait.viewBox}
        role={props.alt ? 'img' : undefined}
        aria-label={props.alt || undefined}
        aria-hidden={props.alt ? undefined : true}
      >
        <defs>
          <clipPath id={clipId}>
            <rect {...portrait.bounds} />
          </clipPath>
        </defs>
        <image
          clipPath={`url(#${clipId})`}
          href={primary}
          width="971"
          height="1619"
          preserveAspectRatio="none"
          onError={() => setFailed((paths) => [...paths, primary])}
        />
      </svg>
    );
  return src ? (
    <img
      {...props}
      src={src}
      alt={props.alt ?? ''}
      draggable={false}
      onError={() => setFailed((paths) => [...paths, src])}
    />
  ) : (
    <Bot className={props.className} size={24} aria-hidden="true" />
  );
}
export function Avatar({
  agent,
  status = 'pending',
  small = false,
}: {
  agent?: Pick<AgentProfile, 'id' | 'avatar'>;
  status?: StepStatus;
  small?: boolean;
}) {
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  const pose =
    status === 'approved'
      ? 'approved.png'
      : status === 'running' && !reduced
        ? 'working.gif'
        : 'idle.png';
  return (
    <span className={`pixel-avatar ${small ? 'small' : ''} ${status}`} aria-hidden="true">
      <AgentImage avatar={agent?.avatar} agentId={agent?.id} pose={pose} />
    </span>
  );
}
