import {
  appendDiagnosticBundleLines,
  type CrashReportDiagnosticBundle
} from './crash-reporting-diagnostic-bundle'
import { appendMinidumpSignatureLines } from './crash-report-signature-lines'
import { formatCrashReportExitCode } from './crash-report-exit-code'
import { sanitizeCrashReportString } from './crash-report-redaction'

export {
  sanitizeCrashReportBreadcrumbs,
  sanitizeCrashReportDetails,
  sanitizeCrashReportString
} from './crash-report-redaction'

export type { CrashReportDiagnosticBundle } from './crash-reporting-diagnostic-bundle'

export type CrashReportStatus = 'pending' | 'sent' | 'dismissed'
export type CrashReportSource = 'renderer' | 'child'

export type CrashReportDetailValue = string | number | boolean | null
export type CrashReportBreadcrumbData = Record<string, CrashReportDetailValue>

export type CrashReportBreadcrumb = {
  createdAt: string
  name: string
  data?: CrashReportBreadcrumbData
}

export type CrashReportBreadcrumbInput = {
  createdAt: string
  name: string
  data?: Record<string, unknown>
}

export type CrashReportRecord = {
  id: string
  createdAt: string
  status: CrashReportStatus
  source: CrashReportSource
  processType: string
  reason: string
  exitCode: number | null
  appVersion: string
  platform: NodeJS.Platform
  osRelease: string
  arch: string
  electronVersion: string
  chromeVersion: string
  details: Record<string, CrashReportDetailValue>
  breadcrumbs?: CrashReportBreadcrumb[]
}

export type UncapturedCrashReportContext = {
  createdAt: string
  appVersion: string
  platform: NodeJS.Platform
  osRelease: string
  arch: string
  electronVersion: string
  chromeVersion: string
}

export type CrashReportCreateInput = Omit<
  CrashReportRecord,
  'id' | 'createdAt' | 'status' | 'details' | 'breadcrumbs'
> & {
  details: Record<string, unknown>
  breadcrumbs?: CrashReportBreadcrumbInput[]
}

export type ReactErrorBoundarySurface =
  | 'app-root'
  | 'web-root'
  | 'workspace-shell'
  | 'sidebar'
  | 'terminal-workbench'
  | 'right-sidebar'
  | 'page'
  | 'modal'
  | 'overlay'
  | 'rich-markdown-editor'
  | 'dashboard-popout'

export type ReactErrorBoundaryReportArgs = {
  boundaryId: string
  surface: ReactErrorBoundarySurface
  errorName: string
  errorMessage: string
  errorStack?: string
  componentStack?: string
  activeView?: string
  activeModal?: string | null
  activeTabType?: string | null
  activeRightSidebarTab?: string | null
  hasActiveWorktree?: boolean
}

export type ReactErrorBoundaryReportResult =
  | { ok: true; report: CrashReportRecord | null; deduped: boolean }
  | { ok: false; error: string }

export type CrashReportSubmitArgs = {
  reportId?: string
  notes?: string
  includeDiagnosticLogs?: boolean
  submitAnonymously?: boolean
  githubLogin: string | null
  githubEmail: string | null
}

export type CrashReportSubmitResult =
  | { ok: true; report: CrashReportRecord | null; diagnosticBundle?: CrashReportDiagnosticBundle }
  | {
      ok: false
      status: number | null
      error: string
      report?: CrashReportRecord | null
      diagnosticBundle?: CrashReportDiagnosticBundle
    }

export type CrashReportCopySubmissionFailure = {
  error: string
  diagnosticContext?:
    | { status: 'uploaded'; ticketId: string }
    | { status: 'not_uploaded'; reason: string }
}

export type CrashReportCopyDiagnosticsArgs = {
  reportId?: string
  notes?: string
  submissionFailure?: CrashReportCopySubmissionFailure
}

// Why: notes are free-form prose, not a telemetry detail value. 240 chars cut real
// reports mid-sentence; 8k is a full page and still only 12% of the report budget.
export const MAX_USER_NOTES_LENGTH = 8_000
// Why: redaction shrinks text, so sanitize a little more than the budget and let the
// cap land on the redacted result. Bounding the input is the point: the sanitizer
// walks it with backtracking patterns, and an unbounded paste is a frozen dialog.
const MAX_USER_NOTES_SANITIZE_LENGTH = MAX_USER_NOTES_LENGTH * 2
const MAX_FORMATTED_REPORT_LENGTH = 64_000
const FORMATTED_REPORT_TRUNCATION_SUFFIX =
  '\n\n[Crash report truncated to fit feedback endpoint limits.]'
export function isCrashReportReason(reason: string): boolean {
  return [
    'abnormal-exit',
    'crashed',
    'integrity-failure',
    'killed',
    'launch-failed',
    'memory-eviction',
    'oom'
  ].includes(reason)
}

export function isReactErrorBoundaryReport(report: CrashReportRecord): boolean {
  return (
    report.source === 'renderer' &&
    report.processType === 'react-render' &&
    report.reason === 'react-error-boundary'
  )
}

// Why: notes lead the report because the 64k tail truncation would otherwise drop
// the one irreplaceable section whenever details or breadcrumbs run long.
const USER_NOTES_BEGIN = '--- begin user notes ---'
const USER_NOTES_END = '--- end user notes ---'

function appendUserNotesLines(lines: string[], notes: string | undefined): void {
  const trimmedNotes = notes?.trim()
  if (!trimmedNotes) {
    return
  }
  const sanitized = sanitizeCrashReportString(
    trimmedNotes.slice(0, MAX_USER_NOTES_SANITIZE_LENGTH),
    MAX_USER_NOTES_LENGTH
  )
  // Why fenced and indented: notes are verbatim user text and now precede the
  // machine-generated sections, so a bare line reading `Details:` would parse
  // ahead of the real one. Two spaces make any note line unmatchable by a
  // line-anchored reader without hurting readability.
  lines.push(
    '',
    'User notes:',
    USER_NOTES_BEGIN,
    ...sanitized.split('\n').map((line) => `  ${line}`),
    USER_NOTES_END
  )
}

export function formatCrashReportText(
  report: CrashReportRecord,
  notes?: string,
  diagnosticBundle?: CrashReportDiagnosticBundle
): string {
  const lines = [
    '[Crash Report]',
    '',
    `Report ID: ${report.id}`,
    `Created: ${report.createdAt}`,
    `Status: ${report.status}`,
    `Source: ${report.source}`,
    `Process: ${report.processType}`,
    `Reason: ${report.reason}`,
    `Exit code: ${formatCrashReportExitCode(report)}`,
    `App version: ${report.appVersion}`,
    `Platform: ${report.platform} ${report.osRelease} ${report.arch}`,
    `Electron: ${report.electronVersion}`,
    `Chrome: ${report.chromeVersion}`
  ]

  appendUserNotesLines(lines, notes)
  appendMinidumpSignatureLines(lines, report.details)
  appendDiagnosticBundleLines(lines, diagnosticBundle, sanitizeCrashReportString)

  const details = Object.entries(report.details)
  if (details.length > 0) {
    lines.push('', 'Details:')
    for (const [key, value] of details) {
      lines.push(`- ${key}: ${String(value)}`)
    }
  }

  if (report.breadcrumbs && report.breadcrumbs.length > 0) {
    lines.push('', 'Recent activity:')
    for (const breadcrumb of report.breadcrumbs) {
      const data = breadcrumb.data ? Object.entries(breadcrumb.data) : []
      const suffix =
        data.length > 0
          ? ` (${data.map(([key, value]) => `${key}=${String(value)}`).join(', ')})`
          : ''
      lines.push(`- ${breadcrumb.createdAt}: ${breadcrumb.name}${suffix}`)
    }
  }

  return truncateFormattedCrashReport(lines.join('\n'))
}

export function formatUncapturedCrashReportText(
  context: UncapturedCrashReportContext,
  notes?: string,
  diagnosticBundle?: CrashReportDiagnosticBundle
): string {
  const lines = [
    // Why the header is unchanged: every archived report in the crash channel
    // starts with this line and the reader is an out-of-tree service, so a
    // prefix-anchored parser there would break on a new spelling. The additive
    // `Submission kind` below is what distinguishes feedback. Note this does
    // not change how the submission is counted: submissionType stays 'crash'
    // on the wire, so the taxonomy is a separate server-side change.
    '[Crash Report]',
    '',
    'Report ID: not captured',
    'Submission kind: help-menu-feedback',
    `Created: ${context.createdAt}`,
    'Status: uncaptured',
    'Source: user-reported',
    'Process: unknown',
    'Reason: no captured crash report',
    'Exit code: unknown',
    `App version: ${context.appVersion}`,
    `Platform: ${context.platform} ${context.osRelease} ${context.arch}`,
    `Electron: ${context.electronVersion}`,
    `Chrome: ${context.chromeVersion}`,
    '',
    'Details:',
    '- captured_crash_report: false',
    '- report_source: help_menu'
  ]

  appendUserNotesLines(lines, notes)
  appendDiagnosticBundleLines(lines, diagnosticBundle, sanitizeCrashReportString)

  return truncateFormattedCrashReport(lines.join('\n'))
}

function truncateFormattedCrashReport(text: string): string {
  if (text.length <= MAX_FORMATTED_REPORT_LENGTH) {
    return text
  }
  // Why: the feedback endpoint accepts larger crash bodies and handles
  // Slack-specific attachments server-side. Keep local reports below that API cap.
  const budget = MAX_FORMATTED_REPORT_LENGTH - FORMATTED_REPORT_TRUNCATION_SUFFIX.length
  return `${text.slice(0, Math.max(0, budget)).trimEnd()}${FORMATTED_REPORT_TRUNCATION_SUFFIX}`
}
