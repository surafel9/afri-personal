import { describe, it, expect } from 'vitest';
import {
  normalizeText,
  resolveSkillAlias,
  normalizeSkillList,
  extractSkillMentions,
} from '../normalizer.js';

describe('resolveSkillAlias', () => {
  it('nodejs → node.js', () => {
    expect(resolveSkillAlias('nodejs')).toBe('node.js');
  });

  it('js → javascript', () => {
    expect(resolveSkillAlias('js')).toBe('javascript');
  });

  it('ts → typescript', () => {
    expect(resolveSkillAlias('ts')).toBe('typescript');
  });

  it('reactjs → react', () => {
    expect(resolveSkillAlias('reactjs')).toBe('react');
  });

  it('postgres → postgresql', () => {
    expect(resolveSkillAlias('postgres')).toBe('postgresql');
  });

  it('nextjs → next.js', () => {
    expect(resolveSkillAlias('nextjs')).toBe('next.js');
  });

  it('vuejs → vue.js', () => {
    expect(resolveSkillAlias('vuejs')).toBe('vue.js');
  });

  it('k8s → kubernetes', () => {
    expect(resolveSkillAlias('k8s')).toBe('kubernetes');
  });

  it('gql → graphql', () => {
    expect(resolveSkillAlias('gql')).toBe('graphql');
  });

  it('mongo → mongodb', () => {
    expect(resolveSkillAlias('mongo')).toBe('mongodb');
  });

  it('nuxtjs → nuxt.js', () => {
    expect(resolveSkillAlias('nuxtjs')).toBe('nuxt.js');
  });

  it('psql → postgresql', () => {
    expect(resolveSkillAlias('psql')).toBe('postgresql');
  });

  it('expressjs → express', () => {
    expect(resolveSkillAlias('expressjs')).toBe('express');
  });

  it('react.js → react', () => {
    expect(resolveSkillAlias('react.js')).toBe('react');
  });

  it('express.js → express', () => {
    expect(resolveSkillAlias('express.js')).toBe('express');
  });

  it('unknown skill passes through unchanged', () => {
    expect(resolveSkillAlias('django')).toBe('django');
  });

  it('preserves already-canonical form (javascript)', () => {
    expect(resolveSkillAlias('javascript')).toBe('javascript');
  });

  it('preserves already-canonical form (typescript)', () => {
    expect(resolveSkillAlias('typescript')).toBe('typescript');
  });
});

describe('normalizeSkillList', () => {
  it('normalizes a mixed list', () => {
    expect(normalizeSkillList(['NodeJS', 'ReactJS', 'TypeScript'])).toEqual([
      'node.js',
      'react',
      'typescript',
    ]);
  });

  it('handles empty list', () => {
    expect(normalizeSkillList([])).toEqual([]);
  });
});

describe('normalizeText', () => {
  it('converts to lowercase', () => {
    expect(normalizeText('Hello World')).toBe('hello world');
  });

  it('collapses whitespace', () => {
    expect(normalizeText('hello   world\t\nfoo')).toBe('hello world foo');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalizeText('  hello  ')).toBe('hello');
  });

  it('applies NFKC normalization', () => {
    // NFKC: ＡＢＣ (fullwidth) → ABC
    expect(normalizeText('\uFF21\uFF22\uFF23')).toBe('abc');
  });
});

describe('extractSkillMentions', () => {
  it('finds node.js, typescript, and react in sample text', () => {
    const text = normalizeText(
      'We need a Node.js developer with TypeScript skills and React experience.',
    );
    const found = extractSkillMentions(text, ['node.js', 'typescript', 'react', 'python']);
    expect(found).toContain('node.js');
    expect(found).toContain('typescript');
    expect(found).toContain('react');
    expect(found).not.toContain('python');
  });

  it('does not match "go" inside "django"', () => {
    const text = normalizeText('We use Django for our backend.');
    // 'golang' canonical with alias 'go lang' — but bare 'go' should not match
    const found = extractSkillMentions(text, ['golang']);
    expect(found).not.toContain('golang');
  });

  it('handles aliases: nodejs in text resolves to node.js canonical', () => {
    const text = normalizeText('NodeJS experience required.');
    const found = extractSkillMentions(text, ['node.js', 'react']);
    expect(found).toContain('node.js');
  });

  it('handles empty knownSkills', () => {
    const text = normalizeText('Node.js and TypeScript developer needed.');
    expect(extractSkillMentions(text, [])).toEqual([]);
  });
});
