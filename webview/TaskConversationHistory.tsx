import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Feature } from '../src/shared/types';
/** A visual index across attempts; native conversations and permissions remain separate. */
export function TaskConversationHistory({
  feature,
  currentAttemptId,
  quote,
  locked = false,
}: {
  feature: Feature;
  currentAttemptId: string;
  quote: (text: string) => void;
  locked?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string[]>([]);
  const [limit, setLimit] = useState(100);
  const groups = feature.steps.flatMap((step) =>
    step.attempts
      .filter((attempt) => attempt.id !== currentAttemptId)
      .map((attempt) => ({
        step,
        attempt,
        messages:
          attempt.pair?.messages.filter((m) => m.kind !== 'reasoning' && m.content.trim()) ?? [],
      })),
  );
  if (!groups.length) return null;
  const query = search.trim().toLocaleLowerCase('fr');
  return (
    <details className="task-conversation-history">
      <summary>Fil de la tâche · {groups.length} étape(s) / tentative(s) précédente(s)</summary>
      <label className="field">
        <span>Rechercher dans les échanges précédents</span>
        <input
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setLimit(100);
          }}
        />
      </label>
      {groups.map(({ step, attempt, messages }) => {
        const matching = messages.filter(
          (m) => !query || m.content.toLocaleLowerCase('fr').includes(query),
        );
        if (query && !matching.length) return null;
        const open = expanded.includes(attempt.id) || Boolean(query);
        return (
          <section key={attempt.id} className="conversation-history-step">
            <button
              type="button"
              className="text-button"
              aria-expanded={open}
              onClick={() =>
                setExpanded((ids) =>
                  ids.includes(attempt.id)
                    ? ids.filter((id) => id !== attempt.id)
                    : [...ids, attempt.id],
                )
              }
            >
              {step.name} · {attempt.agentName ?? step.agentId} · Tentative{' '}
              {step.attempts.indexOf(attempt) + 1} · {attempt.status}
            </button>
            {open && (
              <>
                {matching.slice(-limit).map((m) => (
                  <article key={m.id}>
                    <strong>
                      {m.role === 'user'
                        ? 'Toi'
                        : m.role === 'system'
                          ? 'Décision de travail'
                          : (attempt.agentName ?? step.agentId)}
                    </strong>
                    <div className="markdown">
                      <Markdown remarkPlugins={[remarkGfm]}>
                        {m.content.replace(
                          /```feature-studio-pair-(?:plan|result)[\s\S]*?(?:```|$)/g,
                          '',
                        )}
                      </Markdown>
                    </div>
                    <button
                      type="button"
                      className="text-button"
                      disabled={locked}
                      onClick={() =>
                        quote(
                          `Référence : ${step.name}, tentative ${attempt.id}, message ${m.id}\n${m.content
                            .slice(0, 6000)
                            .split('\n')
                            .map((line) => `> ${line}`)
                            .join('\n')}\n\n`,
                        )
                      }
                    >
                      Citer dans l’échange actuel
                    </button>
                  </article>
                ))}
                {matching.length > limit && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setLimit((n) => n + 100)}
                  >
                    Afficher les échanges plus anciens
                  </button>
                )}
                {!messages.length && (
                  <p>Cette tentative ne contient pas de conversation enregistrée.</p>
                )}
                {!!attempt.pair?.decisions.length && (
                  <details>
                    <summary>Décisions conservées</summary>
                    {attempt.pair.decisions.map((d, i) => (
                      <p key={i}>{d}</p>
                    ))}
                  </details>
                )}
              </>
            )}
          </section>
        );
      })}
    </details>
  );
}
