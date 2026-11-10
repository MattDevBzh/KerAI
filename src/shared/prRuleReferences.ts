const normalize = (text: string) =>
  text
    .normalize('NFKC')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();
const tokenCharacter = /[\p{L}\p{N}_-]/u;
function containsReference(text: string, reference: string): boolean {
  let offset = 0;
  for (;;) {
    const index = text.indexOf(reference, offset);
    if (index < 0) return false;
    const before = text[index - 1],
      after = text[index + reference.length];
    const qualifiedSuffix =
      after === '.' && /[\p{L}\p{N}]/u.test(text[index + reference.length + 1] ?? '');
    // A label delimiter such as "F04:" is allowed; F04 must never match F040.
    if (
      (!before || !tokenCharacter.test(before)) &&
      (!after || !tokenCharacter.test(after)) &&
      !qualifiedSuffix
    )
      return true;
    offset = index + reference.length;
  }
}

/** Presence check only: the relationship between a finding and the diff still needs review. */
export function missingPrRuleReferences(rule: string, sources: string[]): string[] {
  const normalized = normalize(rule);
  if (!normalized) return [];
  const texts = sources.map(normalize);
  const parts = normalized.split(/\s*[/,;&+]\s*|\s+(?:et|and)\s+/u);
  const identifiers =
    parts.length > 1 &&
    parts.every((part) => /^[\p{L}][\p{L}\p{N}_.:-]*\d[\p{L}\p{N}_.:-]*$/u.test(part));
  // Split only explicit lists of identifiers; never guess components of a rule title or range.
  const references = identifiers ? [...new Set(parts)] : [normalized];
  return references.filter(
    (reference) => !texts.some((text) => containsReference(text, reference)),
  );
}
