/**
 * job-detector.ts
 * Determines whether a message is likely a job announcement.
 * Pure heuristic — no external AI.
 */

// Amharic Unicode range U+1200–U+137F
const AMHARIC_RE = /[\u1200-\u137F]/g;

/**
 * Returns the fraction of non-space characters that are Amharic.
 */
function amharicFraction(text: string): number {
  const nonSpace = text.replace(/\s/g, '');
  if (nonSpace.length === 0) return 0;
  const amharicChars = (nonSpace.match(AMHARIC_RE) ?? []).length;
  return amharicChars / nonSpace.length;
}

/** Positive hiring keywords (lowercased). */
const HIRING_KEYWORDS = [
  'we are hiring',
  "we're hiring",
  'were hiring',
  'job opening',
  'position available',
  'vacancy',
  'looking for a',
  'seeking a',
  'job opportunity',
  'career opportunity',
  'apply now',
  'apply by',
  'application deadline',
  'send your cv',
  'send cv',
  'send resume',
  'requirements:',
  'responsibilities:',
  'qualifications:',
  'how to apply',
  'to apply',
  'hiring for',
  'we are looking for',
];

/** Role-title indicators. */
const ROLE_INDICATORS = [
  'developer',
  'engineer',
  'designer',
  'analyst',
  'manager',
  'consultant',
  'specialist',
  'architect',
  'lead',
];

/** Employment markers. */
const EMPLOYMENT_MARKERS = [
  'full-time',
  'fulltime',
  'full time',
  'part-time',
  'parttime',
  'part time',
  'contract',
  'freelance',
  'internship',
  'remote',
  'hybrid',
  'onsite',
  'on-site',
];

/** Disqualifying promo / news signals. */
const PROMO_SIGNALS = [
  /\d[\d,]*\s*(etb|birr)\b/i,          // price + currency
  /\d[\d,]*\s*(usd|dollar|eur|euro)\b/i,
  /limited\s+stock/i,
  /order\s+via\s+telegram/i,
  /screen\s+protector/i,
  /phone\s+case/i,
  /accessories/i,
];

const NEWS_SIGNALS = [
  /annual\s+report/i,
  /\breport\b.{0,30}\bpublish(ed)?/i,
  /\bpublication\b/i,
  /\bsummary\b.{0,40}\breport\b/i,
];

/**
 * Determine if a (normalized, lowercased) message text is a job announcement.
 */
export function isJobAnnouncement(normalizedText: string): boolean {
  // Too short (< 25 chars) or (< 50 chars without any hiring keyword)
  if (normalizedText.length < 25) {
    return false;
  }
  const hasHiringKeyword = HIRING_KEYWORDS.some((kw) => normalizedText.includes(kw));
  if (normalizedText.length < 50 && !hasHiringKeyword) {
    return false;
  }

  // >60% Amharic → likely not an English job post
  if (amharicFraction(normalizedText) > 0.6) {
    return false;
  }

  // Strong disqualifying promo signals (combined with no role indicators)
  const hasPromoSignal = PROMO_SIGNALS.some((re) => re.test(normalizedText));
  const hasNewsSignal = NEWS_SIGNALS.some((re) => re.test(normalizedText));
  const hasRoleIndicator = ROLE_INDICATORS.some((kw) => normalizedText.includes(kw));
  const hasEmploymentMarker = EMPLOYMENT_MARKERS.some((kw) => normalizedText.includes(kw));

  if (hasPromoSignal && !hasRoleIndicator && !hasHiringKeyword) {
    return false;
  }

  if (hasNewsSignal && !hasRoleIndicator && !hasHiringKeyword) {
    return false;
  }

  // Positive: hiring keyword or (role indicator + employment marker)
  if (hasHiringKeyword) return true;
  if (hasRoleIndicator && hasEmploymentMarker) return true;
  if (hasRoleIndicator && normalizedText.length > 150) return true;

  return false;
}
