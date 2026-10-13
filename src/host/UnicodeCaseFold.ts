import mappings from './unicodeCaseFolding.json';

const foldTable: Readonly<Record<string, string>> = mappings;

/** Unicode 17 D145 canonical caseless matching: NFD(toCasefold(NFD(value))). */
export function canonicalCaseless(value: string): string {
  return Array.from(
    value.normalize('NFD'),
    (character) => foldTable[character.codePointAt(0)!.toString(16).padStart(4, '0')] ?? character,
  )
    .join('')
    .normalize('NFD');
}
