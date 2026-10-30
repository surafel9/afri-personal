/**
 * normalizer.ts
 * Text normalization and skill alias resolution for the matching engine.
 * Does NOT mutate stored originals — normalization is only for comparison.
 */

// ── Alias map ─────────────────────────────────────────────────────────────────
// canonical skill → list of aliases (all lowercase, no trailing spaces)

const ALIAS_MAP: Record<string, string[]> = {
  'node.js':      ['nodejs', 'node js', 'node.js', 'node'],
  'javascript':   ['js', 'javascript'],
  'typescript':   ['ts', 'typescript'],
  'react':        ['reactjs', 'react.js', 'react js'],
  'react native': ['react native', 'react-native'],
  'express':      ['expressjs', 'express.js', 'express js'],
  'postgresql':   ['postgres', 'psql', 'pg', 'postgresql'],
  'mongodb':      ['mongo', 'mongodb'],
  'kubernetes':   ['k8s', 'kubernetes'],
  'graphql':      ['gql', 'graphql'],
  'next.js':      ['nextjs', 'next.js', 'next js'],
  'nuxt.js':      ['nuxtjs', 'nuxt.js', 'nuxt js'],
  'vue.js':       ['vuejs', 'vue.js', 'vue js', 'vue'],
  'python':       ['python', 'py'],
  'golang':       ['golang', 'go lang'],
  'ruby':         ['ruby', 'ruby on rails', 'rails'],
  'docker':       ['docker'],
  'redis':        ['redis'],
  'aws':          ['aws', 'amazon web services'],
  'rest api':     ['rest api', 'restful api', 'rest apis', 'restful apis', 'rest'],
  'tailwind':     ['tailwind', 'tailwindcss', 'tailwind css'],
  'jest':         ['jest'],
  'vitest':       ['vitest'],
  'kafka':        ['kafka', 'apache kafka'],
  'spark':        ['spark', 'apache spark'],
  'airflow':      ['airflow', 'apache airflow'],
  'dbt':          ['dbt'],
  'mysql':        ['mysql'],
  'sqlite':       ['sqlite'],
  'fastify':      ['fastify'],
};

// Inverted map: alias → canonical (built once at module load)
const ALIAS_TO_CANONICAL = new Map<string, string>();
for (const [canonical, aliases] of Object.entries(ALIAS_MAP)) {
  for (const alias of aliases) {
    ALIAS_TO_CANONICAL.set(alias.toLowerCase(), canonical);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Normalize text for matching purposes only (NOT for storage).
 * - Unicode NFKC normalization
 * - Lowercase
 * - Collapse whitespace
 * - Trim
 */
export function normalizeText(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolve a single skill token to its canonical form.
 * Input is normalized to lowercase before lookup.
 */
export function resolveSkillAlias(skill: string): string {
  const normalized = skill.toLowerCase().trim();
  return ALIAS_TO_CANONICAL.get(normalized) ?? normalized;
}

/**
 * Apply resolveSkillAlias to each item in a list.
 */
export function normalizeSkillList(skills: string[]): string[] {
  return skills.map(resolveSkillAlias);
}

/**
 * Escape a string for use in a RegExp (handles dots, parens, etc.)
 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extract skill mentions from a normalized text block.
 * Checks for each known canonical skill (and its aliases) using word-boundary matching.
 * Returns deduplicated list of canonical skill names found.
 */
export function extractSkillMentions(normalizedText: string, knownSkills: string[]): string[] {
  const found = new Set<string>();

  for (const canonical of knownSkills) {
    // Collect all surface forms to search: canonical + its aliases
    const aliases = ALIAS_MAP[canonical] ?? [canonical];
    const surfaceForms = Array.from(new Set([canonical, ...aliases])).sort(
      (a, b) => b.length - a.length  // longest first to prefer more specific match
    );

    let matched = false;
    for (const form of surfaceForms) {
      if (matched) break;
      const escaped = escapeRegex(form);
      // Use word boundaries where possible; for terms ending in '.' or special chars,
      // use a lookahead for non-word char or end of string
      const pattern = /[a-z0-9]$/.test(form)
        ? new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'i')
        : new RegExp(`(?<![a-z0-9])${escaped}`, 'i');
      if (pattern.test(normalizedText)) {
        found.add(canonical);
        matched = true;
      }
    }
  }

  return Array.from(found);
}
