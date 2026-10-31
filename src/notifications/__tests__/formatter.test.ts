import { describe, it, expect } from 'vitest';
import { formatNotification, formatVerbatim, escapeHtml } from '../formatter.js';
import type { Evaluation } from '../../database/repositories/evaluations.js';

describe('formatter', () => {
  it('escapes HTML special characters properly', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert("xss")&lt;/script&gt;',
    );
    expect(escapeHtml('React & Node.js > Vue')).toBe(
      'React &amp; Node.js &gt; Vue',
    );
  });

  it('formats evaluation into complete notification with keyboard', () => {
    const fakeEval: Evaluation = {
      id: 1,
      messageId: 10,
      profileVersion: 1,
      ruleEngineVersion: '1.0.0',
      isJobAnnouncement: 1,
      extractedTitle: 'Senior <Node.js> Developer',
      extractedCompany: 'Tech & Co',
      extractedLocation: 'Remote, Africa',
      extractedWorkMode: 'remote',
      extractedEmploymentType: 'fulltime',
      extractedDeadline: 'Nov 15, 2026',
      extractedApplyMethod: 'https://example.com/apply',
      matchedSkills: '["node.js", "typescript"]',
      matchedRoles: '["backend"]',
      missingInfo: '["Salary not specified"]',
      triggeredExclusions: '[]',
      score: 85,
      verdict: 'match',
      matchReasons: '["Matched required skills: node.js, typescript", "Remote work mode matches preference"]',
      evaluatedAt: '2026-10-25T12:00:00Z',
    };

    const formatted = formatNotification(fakeEval, 42);

    expect(formatted.text).toContain('&lt;Node.js&gt;');
    expect(formatted.text).toContain('Tech &amp; Co');
    expect(formatted.text).toContain('🌐 Remote');
    expect(formatted.text).toContain('⭐ <b>Match Score:</b> 85/100');
    expect(formatted.text).toContain('Matched required skills: node.js');
    expect(formatted.text).toContain('Salary not specified');
    expect(formatted.text).toContain('https://example.com/apply');

    // Check keyboard buttons
    const inlineButtons = formatted.keyboard.inline_keyboard[0];
    expect(inlineButtons).toBeDefined();
    expect(inlineButtons?.map((b) => b.text)).toEqual([
      '👍 Relevant',
      '👎 Not relevant',
      '💼 Applied',
    ]);
  });

  it('formats verbatim notification including channel source header', () => {
    const rawText = 'Junior Flutter Developer wanted. Apply at hr@example.com';
    const links = ['https://t.me/DagmawiBabiJobs/543'];

    const formatted = formatVerbatim(rawText, links, 99, 'DagmawiBabiJobs');

    expect(formatted.text).toContain('📡 <b>Source:</b> @DagmawiBabiJobs');
    expect(formatted.text).toContain('Junior Flutter Developer wanted');
    expect(formatted.text).toContain('https://t.me/DagmawiBabiJobs/543');
    expect(formatted.keyboard.inline_keyboard[0]?.[0]?.callback_data).toBe('feedback:99:relevant');
  });
});

