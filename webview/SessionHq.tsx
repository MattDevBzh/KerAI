import { SubplanCardVisual } from './SubplanUI';
import { useRef } from 'react';
import {
  ArrowDown,
  Check,
  Circle,
  Coffee,
  Lightbulb,
  Maximize2,
  MessageCircle,
  Pause,
  RefreshCw,
  SkipForward,
  Sparkles,
  TriangleAlert,
  X,
} from 'lucide-react';
import type { Feature, StepStatus, StudioState } from '../src/shared/types';
import { sessionHqStation } from '../src/shared/sessionHq';
import { Avatar } from './Avatar';
import { useThemeAppearance } from './ThemePicker';
import { QgKitten } from './RewardEffects';
import { HqPaperPlanes, type ActiveHqTransfer } from './HqContextTransfer';
import './session-hq.css';

export const hqRooms = {
  native: { backdrop: 'papier', title: 'L’atelier de l’équipe' },
  jardin: { backdrop: 'atelier', title: 'Le jardin des idées' },
  papier: { backdrop: 'papier', title: 'L’atelier des idées' },
  guilde: { backdrop: 'guilde', title: 'La salle de la guilde' },
  event: { backdrop: 'halloween', title: 'L’atelier des sortilèges' },
  noob: { backdrop: 'papier', title: 'Le tout premier atelier' },
  matrix: { backdrop: 'guilde', title: 'La salle des opérateurs' },
  dragonball: { backdrop: 'dragonball', title: 'Le dojo des guerriers du code' },
} as const;

const statusIcons = {
  pending: Coffee,
  running: Sparkles,
  waiting_input: MessageCircle,
  awaiting_review: Pause,
  approved: Check,
  skipped: SkipForward,
  failed: TriangleAlert,
  cancelled: X,
  stale: RefreshCw,
  interrupted: Pause,
} satisfies Record<StepStatus, typeof Circle>;

export function SessionHq({
  feature,
  state,
  selectedStepId,
  disabled,
  selectStep,
  transfer,
  onExpand,
}: {
  feature: Feature;
  state: StudioState;
  selectedStepId?: string;
  disabled: boolean;
  selectStep: (id: string) => void;
  transfer?: ActiveHqTransfer;
  onExpand?: () => void;
}) {
  const roomRef = useRef<HTMLDivElement>(null);
  const portraits = useRef(new Map<string, HTMLSpanElement>());
  const { family, theme } = useThemeAppearance();
  const room = hqRooms[family];
  const stations = feature.steps.map((step) => ({
    step,
    ...sessionHqStation(
      step,
      state.agents,
      state.humanRequests?.some(
        (request) => request.featureId === feature.id && request.stepId === step.id,
      ),
      feature.optionalRequest?.stepId === step.id,
    ),
  }));
  const working = stations.filter((station) => station.status === 'running').length;
  const waiting = stations.filter((station) =>
    ['waiting_input', 'awaiting_review'].includes(station.status),
  ).length;
  return (
    <nav
      className="session-hq"
      data-hq-theme={theme}
      aria-label="QG de la session"
      data-archived={feature.archived || undefined}
    >
      <div className="hq-heading">
        <div>
          <span className="eyebrow">LE QG DE CETTE SESSION</span>
          <h3>{room.title}</h3>
        </div>
        <div className="hq-summary">
          {onExpand && (
            <button className="button secondary small" disabled={disabled} onClick={onExpand}>
              <Maximize2 size={14} /> Agrandir le QG
            </button>
          )}
          {feature.archived ? (
            <span>Session archivée · dernier état enregistré</span>
          ) : (
            <>
              <span>
                <Sparkles size={14} aria-hidden="true" /> {working} au travail
              </span>
              {waiting > 0 && (
                <span className="hq-needs-you">
                  <MessageCircle size={14} aria-hidden="true" /> {waiting} en attente de toi
                </span>
              )}
              {feature.status === 'awaiting_final_validation' && (
                <span className="hq-needs-you">Validation finale attendue</span>
              )}
              {feature.status === 'completed' && (
                <span>
                  <Check size={14} aria-hidden="true" /> Session terminée
                </span>
              )}
            </>
          )}
        </div>
      </div>
      <div className="hq-room" ref={roomRef}>
        <div className="hq-scenery" aria-hidden="true">
          <img
            className="hq-backdrop"
            src={`${import.meta.env.BASE_URL}qg/${room.backdrop}.png`}
            alt=""
            draggable={false}
          />
        </div>
        <ol className="hq-stations">
          {stations.map(({ step, agent, name, status, label }, index) => {
            const Icon = statusIcons[status];
            const selected = step.id === selectedStepId;
            return (
              <li key={step.id}>
                <button
                  type="button"
                  className={`hq-station ${step.subplan ? 'subplan-card' : ''} status-${status} ${selected ? 'selected' : ''}`}
                  disabled={disabled}
                  aria-current={selected ? 'step' : undefined}
                  aria-label={`Étape ${index + 1} · ${step.name} · ${name} · ${label}`}
                  onClick={() => selectStep(step.id)}
                >
                  <span className="hq-station-title">
                    <span className="hq-number">{String(index + 1).padStart(2, '0')}</span>
                    <strong>{step.name}</strong>
                  </span>
                  <span
                    className="hq-portrait"
                    ref={(element) => {
                      if (element) portraits.current.set(step.id, element);
                      else portraits.current.delete(step.id);
                    }}
                  >
                    <span className="hq-lamp" aria-hidden="true">
                      <Lightbulb size={16} />
                    </span>
                    {step.subplan ? (
                      <SubplanCardVisual step={step} />
                    ) : (
                      <Avatar
                        agent={agent}
                        status={feature.archived && status === 'running' ? 'pending' : status}
                      />
                    )}
                    <span className="hq-desk" aria-hidden="true" />
                  </span>
                  <span className="hq-nameplate">
                    <strong>
                      {step.subplan ? step.subplan.teamName || 'Sous-équipe à configurer' : name}
                    </strong>
                    <span className="hq-status">
                      <Icon size={14} aria-hidden="true" /> {label}
                    </span>
                    {selected && (
                      <span className="hq-selected">
                        <ArrowDown size={12} aria-hidden="true" /> Détail ci-dessous
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <QgKitten />
        {transfer && (
          <HqPaperPlanes
            key={transfer.attemptId}
            transfer={transfer}
            room={roomRef}
            portraits={portraits}
            fromName={
              stations.find((station) => station.step.id === transfer.fromStepId)?.name ?? ''
            }
            toName={stations.find((station) => station.step.id === transfer.toStepId)?.name ?? ''}
          />
        )}
      </div>
      <p className="hq-help">
        {disabled
          ? 'Enregistre ou annule ton brouillon avant de changer d’étape.'
          : 'Chaque poste est une étape. Sélectionne un agent pour retrouver son détail en dessous.'}
      </p>
    </nav>
  );
}
