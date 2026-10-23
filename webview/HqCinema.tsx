import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDownLeft, Maximize2, Minimize2, MonitorUp, Send } from 'lucide-react';
import type { Feature, StudioState } from '../src/shared/types';
import { hqScene, hqSpeech, speechPages } from '../src/shared/hqCinema';
import { sessionHqStation } from '../src/shared/sessionHq';
import { allFeatures } from '../src/shared/subplans';
import { useThemeAppearance } from './ThemePicker';
import { Avatar } from './Avatar';
import { hqRooms } from './SessionHq';
import { HqTaskBoard } from './HqTaskBoard';
import { HqPaperPlanes, useHqContextTransfer } from './HqContextTransfer';
import { useDialogAccessibility } from './Ergonomics';
import { isHosted, send, subscribe } from './bridge';
import './hq-cinema.css';

export function HqCinema({
  root,
  state,
  reduce,
}: {
  root: Feature;
  state: StudioState;
  reduce: (featureId: string, stepId?: string) => void;
}) {
  const scene = hqScene(root, state);
  const { feature, step, request } = scene;
  const ref = useRef<HTMLElement>(null);
  const room = useRef<HTMLDivElement>(null);
  const portraits = useRef(new Map<string, HTMLSpanElement>());
  const { family, theme } = useThemeAppearance();
  const transfer = useHqContextTransfer(feature, !root.archived);
  const speech = hqSpeech(scene);
  const pages = speechPages(speech.text);
  const [speechPage, setSpeechPage] = useState(0);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<string>();
  const pendingRef = useRef<string | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const previousScene = useRef({ id: feature.id, root });
  const [arrival, setArrival] = useState<{ text: string; delivery: boolean }>();
  const close = () => {
    // Exiting this browser's fullscreen does not cancel or restart a running session.
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    reduce(feature.id, step?.id);
  };
  useDialogAccessibility(ref, close);
  useEffect(() => {
    setSpeechPage(0);
  }, [speech.id, feature.id, step?.id]);
  useEffect(() => {
    if (pages.length < 2) return;
    const interval = setInterval(
      () => {
        if (!document.hidden) setSpeechPage((value) => (value + 1) % pages.length);
      },
      Math.max(8000, (pages[Math.min(speechPage, pages.length - 1)]?.length ?? 0) * 48),
    );
    return () => clearInterval(interval);
  }, [pages.length, speechPage, speech.id]);
  useEffect(() => {
    if (previousScene.current.id !== feature.id && !document.hidden && !root.archived) {
      const before = allFeatures([previousScene.current.root]).find((f) => f.id === feature.id);
      const delivery =
        !before ||
        Boolean(
          step?.status === 'running' &&
            !before.steps
              .find((s) => s.id === step.id)
              ?.attempts.some((a) => a.id === step.attempts.at(-1)?.id),
        );
      setArrival({
        delivery,
        text: scene.iteration
          ? `${delivery ? 'Contexte transmis à l’atelier' : 'Atelier'} ${scene.number} / ${scene.total}`
          : 'Retour au QG de la session',
      });
    }
    previousScene.current = { id: feature.id, root };
  }, [root, feature.id, scene.iteration, scene.number, scene.total, step]);
  useEffect(() => {
    if (!arrival) return;
    const timeout = setTimeout(() => setArrival(undefined), 5000);
    const hide = () => {
      if (document.hidden) setArrival(undefined);
    };
    document.addEventListener('visibilitychange', hide);
    return () => {
      clearTimeout(timeout);
      document.removeEventListener('visibilitychange', hide);
    };
  }, [arrival]);
  useEffect(() => {
    const unsubscribe = subscribe((message) => {
      if (message.type !== 'hqWindowResult' || message.requestId !== pendingRef.current) return;
      clearTimeout(timer.current);
      pendingRef.current = undefined;
      setPending(undefined);
      setError(message.error ?? '');
    });
    return () => {
      unsubscribe();
      clearTimeout(timer.current);
    };
  }, []);
  const windowAction = async (action: 'detach' | 'fullscreen') => {
    if (pendingRef.current) return;
    setError('');
    if (!isHosted) {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen();
      } catch {
        setError('Le plein écran est indisponible ici. Le QG reste agrandi dans cette fenêtre.');
      }
      return;
    }
    const id = crypto.randomUUID();
    pendingRef.current = id;
    setPending(id);
    send({ type: 'hqWindow', action, requestId: id });
    timer.current = setTimeout(() => {
      pendingRef.current = undefined;
      setPending(undefined);
      setError(
        'La fenêtre n’a pas confirmé le changement. Tu peux utiliser le menu Affichage de VS Code.',
      );
    }, 15000);
  };
  const station =
    step &&
    sessionHqStation(
      step,
      state.agents,
      Boolean(request),
      feature.optionalRequest?.stepId === step.id,
    );
  const otherStations = feature.steps
    .filter((s) => s.id !== step?.id)
    .map((s) => ({ step: s, ...sessionHqStation(s, state.agents) }));
  const [stationPage, setStationPage] = useState(0);
  const stationPages = Math.max(1, Math.ceil(otherStations.length / 6));
  useEffect(() => {
    setStationPage(0);
  }, [feature.id]);
  useEffect(() => {
    if (stationPages < 2 || transfer) return;
    const interval = setInterval(() => {
      if (!document.hidden) setStationPage((p) => (p + 1) % stationPages);
    }, 14000);
    return () => clearInterval(interval);
  }, [stationPages, transfer]);
  useEffect(() => {
    if (transfer) {
      const index = otherStations.findIndex((s) => s.step.id === transfer.fromStepId);
      if (index >= 0) setStationPage(Math.floor(index / 6));
    }
  }, [transfer]);
  const register = (id: string, element: HTMLSpanElement | null) => {
    if (element) portraits.current.set(id, element);
    else portraits.current.delete(id);
  };
  return createPortal(
    <section
      className="session-hq hq-cinema"
      data-hq-theme={theme}
      data-workshop={Boolean(scene.iteration)}
      data-archived={root.archived || undefined}
      role="dialog"
      aria-modal="true"
      aria-label="QG grand écran"
      ref={ref}
      tabIndex={-1}
    >
      <header className="cinema-toolbar">
        <div className="cinema-session">
          <span className="cinema-indicator" data-attention={speech.kind === 'attention'} />
          <strong>{root.title}</strong>
          <span>{root.archived ? 'Dernier état enregistré' : 'Suivi automatique'}</span>
        </div>
        <div className="cinema-controls">
          {isHosted && (
            <button
              disabled={Boolean(pending)}
              onClick={() => void windowAction('detach')}
              title="Déplacer le cockpit dans une fenêtre indépendante, puis sur ton écran secondaire"
            >
              <MonitorUp size={16} /> Détacher
            </button>
          )}
          <button disabled={Boolean(pending)} onClick={() => void windowAction('fullscreen')}>
            <Maximize2 size={16} /> Plein écran / fenêtré
          </button>
          <button className="cinema-reduce" onClick={close}>
            <Minimize2 size={16} /> Réduire pour intervenir
          </button>
        </div>
      </header>
      {error && (
        <p className="cinema-window-error" role="alert">
          {error}
        </p>
      )}
      <div className="cinema-room" ref={room}>
        <div className="cinema-scenery" aria-hidden="true">
          <img src={`${import.meta.env.BASE_URL}qg/${hqRooms[family].backdrop}.png`} alt="" />
          <div className="cinema-workshop-wall">
            <span className="cinema-window" />
            <span className="cinema-shelf">
              <i />
              <i />
              <i />
            </span>
            <span className="cinema-tools">✎ ◇ ⚒</span>
          </div>
        </div>
        <div className="cinema-placard">
          <span>
            {scene.iteration
              ? `ATELIER · SOUS-TÂCHE ${scene.number} / ${scene.total}`
              : 'LE QG DE LA SESSION'}
          </span>
          <h2>{scene.iteration?.title ?? hqRooms[family].title}</h2>
          {scene.path.length > 1 && (
            <p>
              {scene.path
                .slice(0, -1)
                .map((f) => f.title)
                .join(' › ')}
            </p>
          )}
        </div>
        <div className="cinema-stage">
          <div className="cinema-focus">
            <div className={`cinema-bubble ${speech.kind}`} key={`${feature.id}:${speech.id}`}>
              <span className="cinema-bubble-label">
                {speech.kind === 'attention'
                  ? 'À TOI DE JOUER'
                  : speech.kind === 'message'
                    ? `${station?.name ?? 'L’équipe'} · MESSAGE`
                    : 'EN CE MOMENT'}
              </span>
              <p>{pages[Math.min(speechPage, pages.length - 1)]}</p>
              {pages.length > 1 && (
                <div className="cinema-speech-pages">
                  <span>
                    Extrait {Math.min(speechPage, pages.length - 1) + 1} / {pages.length} · texte
                    complet dans le chat
                  </span>
                  <button
                    aria-label="Extrait suivant du message"
                    onClick={() => setSpeechPage((v) => (v + 1) % pages.length)}
                  >
                    →
                  </button>
                </div>
              )}
              {speech.kind === 'attention' && (
                <small>
                  <ArrowDownLeft size={14} /> Réduis le QG pour répondre dans le cockpit.
                </small>
              )}
            </div>
            {station && step && (
              <div className="cinema-hero">
                <span
                  className="cinema-hero-portrait"
                  ref={(element) => register(step.id, element)}
                >
                  <Avatar
                    agent={station.agent}
                    status={
                      root.archived && station.status === 'running' ? 'pending' : station.status
                    }
                  />
                </span>
                <div className="cinema-nameplate">
                  <strong>{station.name}</strong>
                  <span>
                    {step.name} · {station.label}
                  </span>
                </div>
              </div>
            )}
          </div>
          <div className="cinema-board-zone">
            <HqTaskBoard
              key={`${feature.id}:${step?.id}`}
              step={step}
              name={station?.name ?? 'l’équipe'}
            />
          </div>
        </div>
        <div className="cinema-team" aria-label="Les autres postes de l’équipe">
          {otherStations
            .slice(
              Math.min(stationPage, stationPages - 1) * 6,
              (Math.min(stationPage, stationPages - 1) + 1) * 6,
            )
            .map((s) => (
              <div key={s.step.id} className={`cinema-team-station status-${s.status}`}>
                <span ref={(element) => register(s.step.id, element)}>
                  <Avatar
                    agent={s.agent}
                    status={root.archived && s.status === 'running' ? 'pending' : s.status}
                  />
                </span>
                <div>
                  <strong>{s.name}</strong>
                  <span>{s.step.name}</span>
                  <small>{s.label}</small>
                </div>
              </div>
            ))}
          {stationPages > 1 && (
            <button
              className="cinema-team-more"
              onClick={() => setStationPage((p) => (p + 1) % stationPages)}
            >
              Postes {stationPage + 1} / {stationPages} →
            </button>
          )}
        </div>
        {transfer && (
          <HqPaperPlanes
            key={transfer.attemptId}
            transfer={transfer}
            room={room}
            portraits={portraits}
            fromName={otherStations.find((s) => s.step.id === transfer.fromStepId)?.name ?? ''}
            toName={station?.name ?? ''}
          />
        )}
        {arrival && (
          <div className="cinema-arrival" role="status">
            {arrival.delivery && <Send size={28} />}
            <span>{arrival.text}</span>
          </div>
        )}
      </div>
      <footer className="cinema-footer">
        <span>
          {root.archived
            ? 'Session archivée'
            : speech.kind === 'attention' || station?.status === 'awaiting_review'
              ? 'En attente de ton intervention'
              : (station?.label ?? 'Équipe prête')}
        </span>
        <span>
          Les cases barrées décrivent l’avancement. Les validations restent dans le cockpit.
        </span>
      </footer>
    </section>,
    document.body,
  );
}
