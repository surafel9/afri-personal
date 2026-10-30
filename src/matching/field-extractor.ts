/**
 * field-extractor.ts
 * Extracts structured fields from raw job-post text.
 * Returns null for anything that cannot be reliably determined.
 */

import type { ExtractedFields } from './types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Get first non-empty capture group from a list of patterns. */
function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) {
      const captured = (m[1] ?? m[0]).trim();
      if (captured.length > 0) return captured;
    }
  }
  return null;
}

// ── Title extraction ──────────────────────────────────────────────────────────

function isValidTitle(candidate: string): boolean {
  const lower = candidate.toLowerCase();
  if (/^(someone|anybody|people|person|help)\b/.test(lower)) return false;
  return /developer|engineer|designer|analyst|manager|consultant|specialist|architect|lead|programmer|intern|full-?stack|backend|frontend|devops|data|admin/i.test(
    lower
  );
}

const TITLE_PATTERNS: RegExp[] = [
  // Labeled: "Role: X", "Position: X"
  /^(?:role|position|title|job title|opening)\s*[:\-–—]?\s*(.{3,100}?)(?:\n|$)/im,
  /^(?:we are hiring a?n?|hiring a?n?|seeking a?n?|looking for a?n?)\s*[:\-–—]?\s*(.{3,100}?)(?:\n|$)/im,
  // Bold markdown title at start of message
  /^\*{1,2}([A-Z][^\n*]{5,80}?)\*{1,2}/m,
  // Standalone title-like line: short, no sentence punctuation, starts with capital
  /^([A-Z][A-Za-z0-9 \/\-+.()&]{4,80})(?:\s*[-–—]\s*[A-Za-z ]+)?$/m,
];

function extractTitle(text: string): string | null {
  // Try strictly labeled patterns first
  const labeled = firstMatch(text, [TITLE_PATTERNS[0]!]);
  if (labeled) return labeled.replace(/[!.,;:—–-]+$/, '').trim().slice(0, 100);

  // Check the first few lines
  const lines = text.split('\n').map((l) => l.trim());
  for (const line of lines.slice(0, 4)) {
    const rawClean = line.replace(/^[🚀👨‍💻💼🎓🔥✅📍💰🎉⚡★•·\-*#]+\s*/, '').trim();
    const clean = rawClean.replace(/[!.,;:—–-]+$/, '').trim();
    
    // Check if line has hiring prefix
    const stripped = clean.replace(/^(?:we are hiring a?n?|hiring a?n?|seeking a?n?|looking for a?n?)\s*[:\-–—]?\s*/i, '').trim();
    if (stripped.length >= 5 && stripped.length <= 100 && !/https?:\/\//.test(stripped) && isValidTitle(stripped)) {
      return stripped.slice(0, 100);
    }

    if (
      clean.length >= 8 &&
      clean.length <= 100 &&
      /[A-Za-z]/.test(clean) &&
      !/https?:\/\//.test(clean) &&
      isValidTitle(clean)
    ) {
      return clean.slice(0, 100);
    }
  }

  // Bold markdown
  const bold = firstMatch(text, [TITLE_PATTERNS[2]!]);
  if (bold && isValidTitle(bold)) return bold.replace(/[!.,;:—–-]+$/, '').trim().slice(0, 100);

  return null;
}

// ── Company extraction ────────────────────────────────────────────────────────

const COMPANY_PATTERNS: RegExp[] = [
  /company\s*[:\-–—]\s*(.{2,60}?)(?:\n|$)/i,
  /hiring\s+for\s*[:\-–—]?\s*(.{2,60}?)(?:\n|$)/i,
  /about\s+([A-Z][A-Za-z0-9 &.,()-]{1,50}?)\s*[:\-–—]/,
  /^\s*([A-Z][A-Za-z0-9 &.,()-]{2,50}(?:Inc\.?|Ltd\.?|PLC|LLC|Co\.?|Digital|Labs|Tech|Technologies|Finance|Financial)?)\s*(?:\(|$)/m,
];

function extractCompany(text: string): string | null {
  return firstMatch(text, COMPANY_PATTERNS.slice(0, 3));
}

// ── Location extraction ───────────────────────────────────────────────────────

const LOCATION_PATTERNS: RegExp[] = [
  /📍\s*(.{2,80}?)(?:\n|$)/,
  /location\s*[:\-–—]\s*(.{2,80}?)(?:\n|$)/i,
  /based\s+in\s+(.{2,60}?)(?:\n|,|$)/i,
];

const KNOWN_CITIES = [
  'addis ababa', 'nairobi', 'lagos', 'accra', 'dar es salaam',
  'kampala', 'kigali', 'abuja', 'johannesburg', 'cape town',
];

function extractLocation(text: string): string | null {
  const labeled = firstMatch(text, LOCATION_PATTERNS);
  if (labeled) return labeled;

  const lower = text.toLowerCase();
  for (const city of KNOWN_CITIES) {
    if (lower.includes(city)) return city;
  }

  return null;
}

// ── Work mode extraction ──────────────────────────────────────────────────────

function extractWorkMode(text: string): ExtractedFields['workMode'] {
  const lower = text.toLowerCase();

  const remoteSignals = [
    '100% remote', 'fully remote', 'full remote', 'work from anywhere',
    'remote forever', 'remote (', 'remote-', '- remote', 'remote\n',
    'remote only', 'remote first',
  ];
  const onsiteSignals = [
    'onsite only', 'on-site only', 'no remote', 'must be in office',
    'report to office', 'must report', 'in office', 'in-office',
    'no remote work', 'onsite\n', 'on-site\n', '(onsite)', 'onsite)',
  ];
  const hybridSignals = [
    'hybrid', 'partial remote', 'days/week in office', 'days a week in office',
    'days per week in office', 'days in office',
  ];

  const hasRemote = remoteSignals.some((s) => lower.includes(s)) || /\bremote\b/.test(lower);
  const hasOnsite = onsiteSignals.some((s) => lower.includes(s)) || /\bonsite\b|\bon-site\b/.test(lower);
  const hasHybrid = hybridSignals.some((s) => lower.includes(s));

  if (hasHybrid) return 'hybrid';
  if (hasOnsite && !hasRemote) return 'onsite';
  if (hasOnsite && hasRemote) {
    if (lower.includes('occasional remote') || /location.*onsite/i.test(text) || /\(onsite\)/i.test(text)) {
      return 'onsite';
    }
    const strongOnsite = ['no remote', 'onsite only', 'must be in office', 'no remote work'];
    if (strongOnsite.some((s) => lower.includes(s))) return 'onsite';
    if (['100% remote', 'fully remote', 'full remote'].some((s) => lower.includes(s))) return 'remote';
    return 'onsite';
  }
  if (hasRemote) return 'remote';

  return null;
}

// ── Employment type extraction ────────────────────────────────────────────────

function extractEmploymentType(text: string): ExtractedFields['employmentType'] {
  const lower = text.toLowerCase();

  if (/\binternship\b|\bintern\b|\btrainee\b/.test(lower)) return 'internship';
  if (/\bfreelance\b|\bfreelancer\b/.test(lower)) return 'freelance';
  if (/\bpart[-\s]?time\b/.test(lower)) return 'parttime';
  if (/\bcontract\b|\bfixed[-\s]?term\b|\bshort[-\s]?term\b/.test(lower)) return 'contract';
  if (/\bfull[-\s]?time\b|\bfulltime\b|\bpermanent\b/.test(lower)) return 'fulltime';

  return null;
}

// ── Seniority extraction ──────────────────────────────────────────────────────

function extractSeniority(text: string): ExtractedFields['seniority'] {
  // Check first 4 lines (title/header area)
  const header = text.split('\n').slice(0, 4).join(' ').toLowerCase();
  if (/\btech\s+lead\b|\bengineering\s+lead\b|\bteam\s+lead\b/.test(header)) return 'lead';
  if (/\bjunior\b|\bjr\.\b|\bentry[-\s]level\b|\bfresh\s+graduate\b|\bintern\b|\binternship\b/.test(header)) return 'junior';
  if (/\bmid[-\s]level\b|\bmid\s+level\b|\bmid\b/.test(header)) return 'mid';
  if (/\bsenior\b|\bsr\.\b|\blead\s+\w+\b|\bprincipal\b/.test(header)) return 'senior';

  const lower = text.toLowerCase();
  if (/\btech\s+lead\b|\bengineering\s+lead\b|\bteam\s+lead\b/.test(lower)) return 'lead';

  const isJunior =
    (/\bjunior\b|\bjr\.\b|\bentry[-\s]level\b|\bfresh\s+graduate\b|\b0[-–]2\s*years?\b|\b1\+\s*year\b/.test(lower) ||
      /\binternship\b|\bintern\b/.test(lower)) &&
    !/mentoring junior|mentor junior|guide junior/.test(lower);

  const isSenior =
    /\bsenior\b|\bsr\.\b|\blead\s+\w+\b|\bprincipal\b|\b[5-9]\+\s*years?\b|\b1[0-9]\+\s*years?\b/.test(lower) &&
    !/work alongside senior|alongside senior|reporting to senior|work with senior/.test(lower);

  const isMid = /\bmid[-\s]level\b|\bmid\s+level\b|\b3\+\s*years?\b|\b4\+\s*years?\b/.test(lower);

  if (isJunior && !isSenior) return 'junior';
  if (isSenior && !isJunior) return 'senior';
  if (isJunior && isSenior) return 'junior';
  if (isMid) return 'mid';

  return null;
}

// ── Deadline extraction ───────────────────────────────────────────────────────

const DEADLINE_PATTERNS: RegExp[] = [
  /deadline\s*[:\-–—]\s*(.{3,60}?)(?:\n|$)/i,
  /apply\s+by\s*[:\-–—]?\s*(.{3,60}?)(?:\n|$)/i,
  /application\s+(?:closes?|deadline)\s*[:\-–—]?\s*(.{3,60}?)(?:\n|$)/i,
  /before\s+((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s*\d{0,4})/i,
  /closing\s+date\s*[:\-–—]?\s*(.{3,60}?)(?:\n|$)/i,
];

function extractDeadline(text: string): string | null {
  return firstMatch(text, DEADLINE_PATTERNS);
}

// ── Apply method extraction ───────────────────────────────────────────────────

function extractApplyMethod(text: string): string | null {
  // URL
  const urlMatch = /https?:\/\/[^\s\])"']+/.exec(text);
  if (urlMatch) return urlMatch[0];

  // Email
  const emailMatch = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.exec(text);
  if (emailMatch) return emailMatch[0];

  // Telegram handle
  const tgMatch = /@[a-zA-Z][a-zA-Z0-9_]{3,}/.exec(text);
  if (tgMatch) return tgMatch[0];

  return null;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function extractFields(text: string): ExtractedFields {
  return {
    title: extractTitle(text),
    company: extractCompany(text),
    location: extractLocation(text),
    workMode: extractWorkMode(text),
    employmentType: extractEmploymentType(text),
    deadline: extractDeadline(text),
    applyMethod: extractApplyMethod(text),
    seniority: extractSeniority(text),
  };
}
