import { BookOpen, FileText } from 'lucide-react';
import type { NativeContextLoad } from '../src/shared/native';
import './native-context.css';

const origins: Record<string, string> = {
  bundled: 'Catalogue fourni',
  user: 'Ton catalogue personnel',
  workspace: 'Catalogue du projet',
  project: 'Instructions du projet',
  sdk: 'Catalogue KerAI',
  'user-instructions': 'Instructions personnelles',
  plugin: 'Instructions d’un plugin',
};

export function NativeContextPanel({ loads }: { loads: NativeContextLoad[] }) {
  const skills = loads.filter((load) => load.kind === 'skill').length;
  const instructions = loads.length - skills;
  return (
    <details className="native-context-panel">
      <summary>
        <BookOpen size={16} aria-hidden="true" />
        <strong>Compétences et instructions chargées</strong>
        <span>
          {skills} compétence{skills > 1 ? 's' : ''} · {instructions} instruction
          {instructions > 1 ? 's' : ''}
        </span>
      </summary>
      <p>
        Chargements confirmés par Copilot pour cette tentative. Une compétence disponible dans le
        catalogue n’est pas forcément chargée.
      </p>
      {!loads.length && (
        <p>
          Aucun chargement confirmé pour l’instant. Les anciens historiques peuvent ne pas contenir
          ces preuves.
        </p>
      )}
      {loads.map((load) => (
        <details className="native-context-entry" key={load.id}>
          <summary>
            {load.kind === 'skill' ? (
              <BookOpen size={15} aria-hidden="true" />
            ) : (
              <FileText size={15} aria-hidden="true" />
            )}
            <strong>{load.name}</strong>
            <span>
              {load.kind === 'skill'
                ? 'Compétence chargée'
                : load.trigger === 'view-instruction'
                  ? 'Instruction consultée'
                  : 'Instruction chargée'}
            </span>
          </summary>
          <div className="native-context-meta">
            <span>{origins[load.origin] ?? load.origin}</span>
            <time dateTime={load.at}>{new Date(load.at).toLocaleString('fr-FR')}</time>
          </div>
          {load.path && <p className="native-context-path">Source : {load.path}</p>}
          {load.triggerFile && (
            <p className="native-context-path">
              Déclenchée par : {load.triggerFile} ({load.trigger})
            </p>
          )}
          <p>
            {load.trigger === 'view-instruction'
              ? 'Extrait effectivement lu et transmis à l’agent :'
              : 'Contenu transmis lors du chargement :'}
          </p>
          <pre>{load.content}</pre>
          {load.truncated && (
            <p>Extrait limité à 64 000 caractères. L’événement complet reste dans l’archive.</p>
          )}
          <small>
            Ce chargement ne valide aucune étape et n’accorde aucune permission d’exécution.
          </small>
        </details>
      ))}
    </details>
  );
}
