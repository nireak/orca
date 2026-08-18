import type {
  CrashReportBreadcrumb,
  CrashReportBreadcrumbInput,
  CrashReportDetailValue
} from './crash-reporting'

/**
 * Redaction applied to everything a crash report carries off this machine.
 *
 * Why its own module: the patterns are the security surface of the feature and are
 * read on their own; the report format around them is not.
 */

const MAX_STRING_DETAIL_LENGTH = 240
const MAX_STACK_DETAIL_LENGTH = 4_000
const MAX_BREADCRUMB_NAME_LENGTH = 80
const MAX_BREADCRUMBS = 30

// Why: the notes box holds a full page now, which is enough to paste a .env
// fragment, a terminal scrollback or a whole private key — and the formatted report
// is POSTed to a Slack channel. Bare emails are deliberately not redacted: the
// submission already carries an allow-listed githubEmail, so redacting an inline one
// only costs triage the reporter's own contact detail.
const SECRET_PATTERNS = [
  /\b(gh[pousr]_[A-Za-z0-9_]{20,})\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\b(sk-[A-Za-z0-9_-]{20,})\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b([A-Za-z0-9._%+-]+:[A-Za-z0-9._%+-]+@)(?=[^/\s]+)/g,
  /\b(token|api[_-]?key|secret|password)=([^&\s]+)/gi
]

// Why: the "not followed by another path or secret" lookaheads bound their
// whitespace run. `\s+` re-scanned the whole run at every position, so a
// space-padded paste was quadratic — 29s on 200KB, in the renderer preview.
const PATH_PATTERNS = [
  /\/(?:Users|home)\/(?:(?!\s{1,4}(?:\/|[A-Za-z]:\\|\\\\|gh[pousr]_|sk-|(?:token|api[_-]?key|secret|password)=))[^"'`<>\n\r)])+/gi,
  /\/(?:Applications|Library|System|Volumes|etc|media|mnt|opt|private|root|srv|tmp|usr|var)\/(?:(?!\s{1,4}(?:\/|[A-Za-z]:\\|\\\\|gh[pousr]_|sk-|(?:token|api[_-]?key|secret|password)=))[^"'`<>\n\r)])+/gi,
  // Why: a path token, not a line. Anchoring on a slash that no word character
  // precedes and stopping at whitespace is what separates /opt/orca/app.log from
  // "8/16/2026", "View/Layout" or "and/or" — the unanchored form ran to end of line
  // and swallowed a whole typed paragraph on the first date a user wrote.
  /(?<![A-Za-z0-9])\/[A-Za-z0-9._-]+\/[^\s"'`<>)]*/g,
  /[A-Za-z]:\\(?:(?!\s{1,4}(?:\/|[A-Za-z]:\\|\\\\|gh[pousr]_|sk-|(?:token|api[_-]?key|secret|password)=))[^"'`<>\n\r)])+/gi,
  /\\\\[^\\\s"'`<>\n\r)]+\\(?:(?!\s{1,4}(?:\/|[A-Za-z]:\\|\\\\|gh[pousr]_|sk-|(?:token|api[_-]?key|secret|password)=))[^"'`<>\n\r)])+/gi,
  // Windows shells print these unexpanded, and they name the user just as directly.
  /%(?:USERPROFILE|APPDATA|LOCALAPPDATA|HOMEDRIVE|HOMEPATH)%[^\s"'`<>)]*/gi
]

export function sanitizeCrashReportString(
  value: string,
  maxLength = MAX_STRING_DETAIL_LENGTH
): string {
  let sanitized = value
  for (const pattern of PATH_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[redacted-path]')
  }
  for (const pattern of SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, (match, key?: string) => {
      if (key && /^(token|api[_-]?key|secret|password)$/i.test(key)) {
        return `${key}=[redacted]`
      }
      return match.includes('@') ? '[redacted-credential]@' : '[redacted-secret]'
    })
  }
  return sanitized.length > maxLength ? `${sanitized.slice(0, maxLength)}...` : sanitized
}

function maxDetailStringLengthForKey(key: string): number {
  const normalizedKey = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
  return /(?:^|_)(?:stack|component_stack|error_stack|minidump_check_message)$/i.test(normalizedKey)
    ? MAX_STACK_DETAIL_LENGTH
    : MAX_STRING_DETAIL_LENGTH
}

export function sanitizeCrashReportDetails(
  details: Record<string, unknown>
): Record<string, CrashReportDetailValue> {
  const sanitized: Record<string, CrashReportDetailValue> = {}
  for (const [key, value] of Object.entries(details)) {
    if (typeof value === 'string') {
      sanitized[key] = sanitizeCrashReportString(value, maxDetailStringLengthForKey(key))
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      sanitized[key] = value
    } else if (typeof value === 'boolean' || value === null) {
      sanitized[key] = value
    }
  }
  return sanitized
}

export function sanitizeCrashReportBreadcrumbs(
  breadcrumbs: CrashReportBreadcrumbInput[] | undefined
): CrashReportBreadcrumb[] | undefined {
  if (!breadcrumbs || breadcrumbs.length === 0) {
    return undefined
  }

  const sanitized = breadcrumbs
    .slice(-MAX_BREADCRUMBS)
    .map((breadcrumb): CrashReportBreadcrumb | null => {
      if (!breadcrumb.name.trim() || !breadcrumb.createdAt.trim()) {
        return null
      }
      const data = breadcrumb.data ? sanitizeCrashReportDetails(breadcrumb.data) : {}
      return {
        createdAt: sanitizeCrashReportString(breadcrumb.createdAt),
        name: sanitizeCrashReportString(breadcrumb.name).slice(0, MAX_BREADCRUMB_NAME_LENGTH),
        ...(Object.keys(data).length > 0 ? { data } : {})
      }
    })
    .filter((breadcrumb): breadcrumb is CrashReportBreadcrumb => breadcrumb !== null)

  return sanitized.length > 0 ? sanitized : undefined
}
