import type {
  BrowserInspection,
  NavigationLocator,
  NavigationStep,
  NavigationCondition,
} from '../../shared/navigation';
export type InspectionRequest = {
  target?: NavigationLocator;
  category?: 'dom' | 'styles' | 'network' | 'sources';
  properties?: string[];
  offset?: number;
};
export type BrowserCapture = {
  path: string;
  sha256: string;
  bytes: number;
  url: string;
  createdAt: string;
  viewport: { width: number; height: number };
  browser: string;
};
export type BrowserActionResult = { url: string; conditions: boolean[] };
export type WorkerCommand =
  | 'prepare'
  | 'open'
  | 'reset'
  | 'act'
  | 'inspect'
  | 'capture'
  | 'conditions'
  | 'recordStart'
  | 'recordPause'
  | 'recordResume'
  | 'recordStop'
  | 'human'
  | 'resume'
  | 'close';
export type WorkerRequest = {
  id: number;
  generation: number;
  command: WorkerCommand;
  payload?: unknown;
};
export type WorkerResponse =
  | { id: number; generation: number; result?: unknown; error?: string }
  | { event: 'record'; generation: number; sequence: number; step: NavigationStep }
  | { event: 'warning' | 'interrupted'; generation: number; message: string };
export type WorkerOpen = {
  origin: string;
  allowedOrigins: string[];
  authenticationOrigins?: string[];
  profilePath: string;
  executablePath?: string;
  headless: boolean;
};
export type WorkerAct = { step: NavigationStep; parameters: Record<string, string> };
export type WorkerResults =
  | BrowserInspection
  | BrowserActionResult
  | BrowserCapture
  | NavigationCondition[];
