import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react';
import { Send } from 'lucide-react';
import type { Feature } from '../src/shared/types';
import {
  hqTransferDuration,
  sessionHqTransfer,
  type HqContextTransfer,
} from '../src/shared/sessionHq';

export interface ActiveHqTransfer extends HqContextTransfer {
  startedAt: number;
}

export function useHqContextTransfer(feature: Feature, enabled = true) {
  const previous = useRef(feature);
  const [transfer, setTransfer] = useState<ActiveHqTransfer>();
  useEffect(() => {
    const next = sessionHqTransfer(previous.current, feature);
    const switched = previous.current.id !== feature.id;
    previous.current = feature;
    if (!enabled || switched || feature.archived || document.hidden) setTransfer(undefined);
    else if (next) setTransfer({ ...next, startedAt: performance.now() });
  }, [feature, enabled]);
  useEffect(() => {
    if (!transfer) return;
    const timer = window.setTimeout(() => setTransfer(undefined), hqTransferDuration);
    const hide = () => {
      if (document.hidden) setTransfer(undefined);
    };
    document.addEventListener('visibilitychange', hide);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', hide);
    };
  }, [transfer]);
  return transfer;
}

export function HqPaperPlanes({
  transfer,
  room,
  portraits,
  fromName,
  toName,
}: {
  transfer: ActiveHqTransfer;
  room: RefObject<HTMLDivElement | null>;
  portraits: RefObject<Map<string, HTMLSpanElement>>;
  fromName: string;
  toName: string;
}) {
  const [paths, setPaths] = useState<string[]>([]);
  const [elapsed] = useState(() => Math.max(0, performance.now() - transfer.startedAt));
  useLayoutEffect(() => {
    const container = room.current;
    const from = portraits.current.get(transfer.fromStepId);
    const to = portraits.current.get(transfer.toStepId);
    if (!container || !from || !to) return;
    const measure = () => {
      const bounds = container.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      // Client coordinates include the cockpit's CSS zoom; motion paths use local CSS pixels.
      const scaleX = container.clientWidth / bounds.width;
      const scaleY = container.clientHeight / bounds.height;
      const point = (portrait: HTMLElement) => {
        const rect = portrait.getBoundingClientRect();
        return {
          x: (rect.left + rect.width / 2 - bounds.left) * scaleX,
          y: (rect.top + rect.height * 0.48 - bounds.top) * scaleY,
        };
      };
      const start = point(from),
        end = point(to);
      const dx = end.x - start.x,
        dy = end.y - start.y;
      const distance = Math.hypot(dx, dy);
      const vertical = Math.abs(dy) > Math.abs(dx);
      setPaths(
        [0, 1, 2, 3].map((index) => {
          const lift = Math.min(110, Math.max(45, distance * 0.4)) + [0, 23, -18, 12][index];
          // Wraps curve beside the portraits; neighbours on one row arc above their desks.
          const bendX = vertical ? Math.min(lift, container.clientWidth * 0.2) : 0;
          const bendY = vertical ? 0 : -lift;
          const controlX = (ratio: number) =>
            Math.max(22, Math.min(container.clientWidth - 22, start.x + dx * ratio + bendX));
          return `M ${start.x} ${start.y} C ${controlX(0.25)} ${Math.max(20, start.y + dy * 0.25 + bendY)}, ${controlX(0.75)} ${Math.max(20, start.y + dy * 0.75 + bendY)}, ${end.x} ${end.y}`;
        }),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (const element of [container, from, to]) observer.observe(element);
    return () => observer.disconnect();
  }, [transfer, room, portraits]);

  return (
    <div
      className="hq-context-transfer"
      data-from-step={transfer.fromStepId}
      data-to-step={transfer.toStepId}
    >
      <div
        className="hq-transfer-caption"
        role="status"
        style={{ animationDelay: `-${elapsed}ms` }}
      >
        <Send size={14} aria-hidden="true" />
        <span>
          <strong>Passage de contexte</strong> · {fromName} → {toName}
        </span>
      </div>
      <svg className="hq-flight-trail" aria-hidden="true">
        {paths[0] && <path d={paths[0]} />}
      </svg>
      {paths.map((path, index) => (
        <span
          key={index}
          className="hq-paper-plane"
          aria-hidden="true"
          style={
            {
              offsetPath: `path("${path}")`,
              '--flight-delay': `${index * 550 - elapsed}ms`,
            } as CSSProperties
          }
        >
          <svg viewBox="0 0 36 28" width="36" height="28">
            <path className="hq-plane-paper" d="M 2 2 L 34 14 L 2 26 L 9 15 Z" />
            <path className="hq-plane-fold" d="M 9 15 L 34 14 L 13 20 Z" />
            <path className="hq-plane-crease" d="M 2 2 L 34 14 L 9 15" />
          </svg>
        </span>
      ))}
    </div>
  );
}
