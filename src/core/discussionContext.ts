import type { DiscussionMessage } from '../shared/discussions';

/** A deterministic recent window, never a model-generated summary. Originals stay in storage. */
export function discussionContext(messages: DiscussionMessage[], budget = 110_000) {
  const eligible = messages.filter((m) => m.role === 'user' || m.status === 'complete');
  const history: { role: string; content: string; images?: string[] }[] = [];
  let truncatedMessages = 0;
  let remaining = budget;
  for (const message of [...eligible].reverse()) {
    const item = {
      role: message.role,
      content: message.content,
      images: message.images?.map((i) => i.name),
    };
    const size = JSON.stringify(item).length;
    if (size > remaining) {
      if (!history.length) {
        // JSON escaping can expand text: bound the encoded value, not just its raw length.
        let end = Math.min(message.content.length, remaining);
        do {
          end = Math.floor(end * 0.8);
          item.content =
            message.content.slice(0, end) +
            '\n[Extrait tronqué pour le contexte ; original conservé.]';
        } while (JSON.stringify(item).length > remaining && end > 0);
        history.unshift(item);
        truncatedMessages++;
      }
      break;
    }
    history.unshift(item);
    remaining -= size + 1;
  }
  return { history, omittedMessages: eligible.length - history.length, truncatedMessages };
}

export function boundedDiscussionSource(source: string, limit = 55_000) {
  if (source.length <= limit) return { text: source, truncated: false };
  return {
    text:
      source.slice(0, limit) +
      '\n[Archive source tronquée dans cette requête ; original conservé. Demander à l’humain les éléments manquants.]',
    truncated: true,
  };
}
