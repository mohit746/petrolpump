// src/lib/csv.ts
//
// Tiny dependency-free CSV exporter. Used by the Reports page (and any
// future page that wants to download tabular data) without pulling in a
// 50KB+ library for what's effectively a string join.
//
// Notes:
//   • RFC 4180 quoting: any cell containing comma / double-quote / newline
//     is double-quoted, with embedded double-quotes escaped as "".
//   • Numeric and Date values are stringified consistently — NaN/null/undefined
//     become empty cells (Excel handles that cleanly).
//   • Adds a UTF-8 BOM so Excel on Windows recognises non-ASCII characters
//     (e.g. ₹) without manual import settings.

export type CsvCell = string | number | boolean | null | undefined | Date

function escapeCell(value: CsvCell): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  const s = String(value)
  // Quote if value contains comma, double quote, CR, or LF.
  if (/[",\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

export function toCsv<T extends Record<string, CsvCell>>(
  rows: T[],
  options?: {
    /** Override the column order / set; defaults to keys of the first row. */
    columns?: Array<keyof T & string>
    /** Custom header labels keyed by column name. */
    headerMap?: Partial<Record<string, string>>
    /** Append a totals row at the bottom. */
    totalsRow?: Partial<Record<string, CsvCell>>
  },
): string {
  if (rows.length === 0 && !options?.columns?.length) return ''

  const cols: string[] =
    options?.columns ??
    Array.from(
      rows.reduce((set, r) => {
        for (const k of Object.keys(r)) set.add(k)
        return set
      }, new Set<string>()),
    )

  const headerLabels = cols.map(c => options?.headerMap?.[c] ?? c)
  const lines: string[] = [headerLabels.map(escapeCell).join(',')]

  for (const row of rows) {
    lines.push(cols.map(c => escapeCell(row[c])).join(','))
  }

  if (options?.totalsRow) {
    lines.push(cols.map(c => escapeCell(options.totalsRow?.[c])).join(','))
  }

  return lines.join('\r\n')
}

/**
 * Trigger a browser download for `content` with the given filename.
 * Adds a UTF-8 BOM to the output so Excel renders non-ASCII bytes correctly.
 */
export function downloadCsv(filename: string, content: string): void {
  const bom = '﻿'
  const blob = new Blob([bom + content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
