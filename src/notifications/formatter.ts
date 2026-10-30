/**
 * formatter.ts
 * Formats match evaluations into Telegram messages using safe HTML escaping.
 * Includes inline keyboard markup for user feedback.
 */

import { InlineKeyboard } from 'grammy';
import type { Evaluation } from '../database/repositories/evaluations.js';
import type { SourceMessage } from '../database/repositories/messages.js';

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export interface FormattedNotification {
  text: string;
  keyboard: InlineKeyboard;
}

export function formatNotification(
  evalRow: Evaluation,
  notificationId: number,
  sourceMsg?: SourceMessage,
): FormattedNotification {
  const parts: string[] = [];

  // Header / Title
  const title = evalRow.extractedTitle
    ? escapeHtml(evalRow.extractedTitle)
    : 'Job Opportunity';
  parts.push(`🎯 <b>${title}</b>`);

  // Key attributes
  const meta: string[] = [];
  if (evalRow.extractedCompany) {
    meta.push(`🏢 <b>Company:</b> ${escapeHtml(evalRow.extractedCompany)}`);
  }
  if (evalRow.extractedWorkMode) {
    const mode =
      evalRow.extractedWorkMode === 'remote'
        ? '🌐 Remote'
        : evalRow.extractedWorkMode === 'hybrid'
          ? '🏢 Hybrid'
          : '📍 Onsite';
    meta.push(`💻 <b>Work Mode:</b> ${mode}`);
  }
  if (evalRow.extractedLocation) {
    meta.push(`📍 <b>Location:</b> ${escapeHtml(evalRow.extractedLocation)}`);
  }
  if (evalRow.extractedEmploymentType) {
    meta.push(`📋 <b>Type:</b> ${escapeHtml(evalRow.extractedEmploymentType)}`);
  }
  if (evalRow.extractedDeadline) {
    meta.push(`⏳ <b>Deadline:</b> ${escapeHtml(evalRow.extractedDeadline)}`);
  }
  if (meta.length > 0) {
    parts.push(meta.join('\n'));
  }

  // Score & Match reasons
  parts.push(`⭐ <b>Match Score:</b> ${evalRow.score}/100`);

  let reasons: string[] = [];
  try {
    reasons = JSON.parse(evalRow.matchReasons);
  } catch {
    reasons = [];
  }
  if (reasons.length > 0) {
    const reasonsFormatted = reasons
      .slice(0, 5)
      .map((r) => `  • ${escapeHtml(r)}`)
      .join('\n');
    parts.push(`💡 <b>Why it matched:</b>\n${reasonsFormatted}`);
  }

  // Missing info warnings
  let missing: string[] = [];
  try {
    missing = JSON.parse(evalRow.missingInfo);
  } catch {
    missing = [];
  }
  if (missing.length > 0) {
    const missingFormatted = missing
      .map((m) => `  ⚠️ ${escapeHtml(m)}`)
      .join('\n');
    parts.push(`<b>Note:</b>\n${missingFormatted}`);
  }

  // Apply method / Link to original post
  const links: string[] = [];
  if (evalRow.extractedApplyMethod) {
    if (evalRow.extractedApplyMethod.startsWith('http')) {
      links.push(`👉 <a href="${evalRow.extractedApplyMethod}">Apply Link</a>`);
    } else {
      links.push(`👉 <b>Apply:</b> ${escapeHtml(evalRow.extractedApplyMethod)}`);
    }
  }

  if (sourceMsg?.links) {
    try {
      const parsedLinks: string[] = JSON.parse(sourceMsg.links);
      for (const link of parsedLinks) {
        if (!links.some((l) => l.includes(link))) {
          links.push(`🔗 <a href="${link}">Original Post Link</a>`);
          break;
        }
      }
    } catch {
      // ignore JSON parse
    }
  }

  if (links.length > 0) {
    parts.push(links.join('\n'));
  }

  const text = parts.join('\n\n');

  // Inline feedback buttons
  const keyboard = new InlineKeyboard()
    .text('👍 Relevant', `feedback:${notificationId}:relevant`)
    .text('👎 Not relevant', `feedback:${notificationId}:not_relevant`)
    .text('💼 Applied', `feedback:${notificationId}:applied`);

  return { text, keyboard };
}

