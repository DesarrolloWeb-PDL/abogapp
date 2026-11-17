/**
 * Search helpers for the client-side list filters.
 *
 * BUG-003 (replica/bugs.md): the Expedientes filter was a plain case-folded
 * `String.includes`, so `gomez` never matched "Gómez…" and typos matched
 * nothing. `searchMatches` keeps the exact/substring behavior and adds:
 *  1. Unicode accent stripping + case folding (NFD → remove combining
 *     marks → lowercase) for exact and substring matching;
 *  2. bounded typo tolerance — Levenshtein distance ≤ 2 (code-point based,
 *     early-bailed, so it is bounded even on huge inputs) between the whole
 *     query / its LAST token (the word the user just typed) and any haystack
 *     token, only for inputs of at least 4 characters. Matching stays
 *     substring-first: a typo-tolerant token never turns the query into an
 *     OR over every token.
 *
 * Pure functions: no I/O, no locale dependence, emoji-safe (iteration is by
 * code point, never by UTF-16 unit).
 */

/** Maximum edit distance a query token may have from a haystack token. */
const MAX_TYPO_DISTANCE = 2;

/** Queries shorter than this never fuzzy-match (bounds false positives). */
const MIN_TYPO_TOKEN_LENGTH = 4;

/** Combining marks (the diacritics NFD splits off); anything else stays. */
const COMBINING_MARKS = /\p{M}+/gu;

/** Word separators for tokenisation: everything that is not a letter/digit. */
const NON_WORD = /[^\p{L}\p{N}]+/gu;

/**
 * Normalize a search string for comparison: strip diacritics, lowercase,
 * trim and collapse whitespace. `"Gómez"` → `"gomez"`; emoji pass through.
 */
export function foldForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Levenshtein distance by code point, bounded by `maxDistance`: returns
 * `maxDistance + 1` as soon as the distance is known to exceed the bound
 * (length gap, or a whole DP row above it) instead of filling the matrix.
 */
export function levenshtein(
  a: string,
  b: string,
  maxDistance: number = MAX_TYPO_DISTANCE,
): number {
  const s = [...a];
  const t = [...b];
  if (Math.abs(s.length - t.length) > maxDistance) return maxDistance + 1;

  let previous = Array.from({ length: t.length + 1 }, (_, i) => i);
  for (let i = 1; i <= s.length; i++) {
    const current = [i];
    for (let j = 1; j <= t.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1),
      );
    }
    // No path through this row can end below its minimum: stop early.
    if (Math.min(...current) > maxDistance) return maxDistance + 1;
    previous = current;
  }

  const distance = previous[t.length];
  return distance > maxDistance ? maxDistance + 1 : distance;
}

/** Word tokens (letters/digits only) of an already folded string. */
function tokens(value: string): string[] {
  return value.split(NON_WORD).filter(Boolean);
}

/**
 * Does `query` match the given haystack (the already-joined fields of a row)?
 * An empty/whitespace query matches everything — the caller shows all rows.
 */
export function searchMatches(query: string, haystack: string): boolean {
  const needle = foldForSearch(query);
  if (!needle) return true;

  const foldedHaystack = foldForSearch(haystack);
  if (foldedHaystack.includes(needle)) return true;

  const haystackTokens = tokens(foldedHaystack);
  if (haystackTokens.length === 0) return false;

  // Whole query plus the LAST token — the word the user just finished
  // typing (the F02-E3 typo `gomezz`) — within the documented bounds.
  const queryTokens = tokens(needle);
  const lastToken = queryTokens[queryTokens.length - 1] ?? "";
  const candidates = [needle, lastToken];
  return candidates
    .filter((token) => token.length >= MIN_TYPO_TOKEN_LENGTH)
    .some((token) =>
      haystackTokens.some(
        (word) => levenshtein(token, word) <= MAX_TYPO_DISTANCE,
      ),
    );
}
