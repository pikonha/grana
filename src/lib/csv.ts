// ponytail: RFC4180-lite — quoted fields, "" escape, sniffed delimiter, no edge-case CSV dialect handling
export function parseCSV(text: string, delimiter = ','): string[][] {
  const stripped = text.replace(/^﻿/, '')
  const lines = stripped.split(/\r?\n/).filter((line) => line.trim())
  const rows: string[][] = []
  for (const line of lines) {
    const fields: string[] = []
    let current = ''
    let inQuote = false
    let i = 0
    while (i < line.length) {
      const char = line[i]
      if (inQuote) {
        if (char === '"') {
          if (line[i + 1] === '"') {
            current += '"'
            i += 2
          } else {
            inQuote = false
            i++
          }
        } else {
          current += char
          i++
        }
      } else {
        if (char === '"') {
          inQuote = true
          i++
        } else if (char === delimiter) {
          fields.push(current)
          current = ''
          i++
        } else {
          current += char
          i++
        }
      }
    }
    fields.push(current)
    rows.push(fields)
  }
  return rows
}

export function sniffDelimiter(header: string): ',' | ';' {
  return header.includes(';') && !header.includes(',') ? ';' : ','
}

// ponytail: last separator wins, no locale detection beyond that
export function toCents(raw: string): number | null {
  const cleaned = raw.replace(/R\$/g, '').trim()
  if (!cleaned || cleaned === '0') return null
  const sign = cleaned.startsWith('-') ? -1 : 1
  const unsigned = cleaned.replace(/^-/, '')
  const lastComma = unsigned.lastIndexOf(',')
  const lastDot = unsigned.lastIndexOf('.')
  let decimal: string
  if (lastComma === -1 && lastDot === -1) {
    decimal = unsigned.replace(/\s/g, '')
  } else {
    const lastSep = Math.max(lastComma, lastDot)
    const afterSep = unsigned.slice(lastSep + 1)
    if (afterSep.length === 2) {
      decimal = unsigned.slice(0, lastSep).replace(/[\s.,]/g, '') + '.' + afterSep
    } else {
      decimal = unsigned.replace(/[\s.,]/g, '')
    }
  }
  const num = Number(decimal)
  if (!Number.isFinite(num) || num <= 0) return null
  const cents = Math.round(num * 100)
  return cents * sign
}

// ponytail: DD/MM only, no timezone math
export function toIsoDate(raw: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const date = new Date(raw + 'T00:00:00')
    if (isNaN(date.getTime())) return null
    return date.toISOString().startsWith(raw) ? raw : null
  }
  const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (!slashMatch) return null
  const [, day, month, year] = slashMatch
  const y = year.length === 2 ? `20${year}` : year
  const m = month.padStart(2, '0')
  const d = day.padStart(2, '0')
  const iso = `${y}-${m}-${d}`
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null
  const date = new Date(iso + 'T00:00:00')
  if (isNaN(date.getTime())) return null
  return date.toISOString().startsWith(iso) ? iso : null
}

/** H:MM, HH:MM or HH:MM:SS → HH:MM (seconds dropped); null if not a valid time. */
export function toTime(raw: string): string | null {
  const match = raw.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/)
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null
  return `${match[1].padStart(2, '0')}:${match[2]}`
}

export function normalizeForMatch(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

export function dupKey(date: string, type: string, amount: number): string {
  return `${date}|${type}|${amount}`
}

const PT_COLS = { data: 'data', hora: 'hora', valor: 'valor', categoria: 'categoria', conta: 'conta', nota: 'nota' }
const EN_COLS = { date: 'data', time: 'hora', amount: 'valor', category: 'categoria', account: 'conta', note: 'nota' }
export function normalizeHeader(header: string[]): Map<string, number> {
  const map = new Map<string, number>()
  for (let i = 0; i < header.length; i++) {
    const norm = normalizeForMatch(header[i])
    const canonical =
      PT_COLS[norm as keyof typeof PT_COLS] ?? EN_COLS[norm as keyof typeof EN_COLS]
    if (canonical) map.set(canonical, i)
  }
  return map
}

export const CSV_TEMPLATE = `data,hora,valor,categoria,conta,nota
01/07/2026,,100.50,Groceries,Nubank,Compras mensais
2026-07-15,18:42,-50.00,Transport,,Uber`
