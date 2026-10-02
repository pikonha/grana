import { describe, expect, test } from 'vitest'
import { dupKey, normalizeForMatch, normalizeHeader, parseCSV, sniffDelimiter, toCents, toIsoDate, toTime } from './csv'

describe('parseCSV', () => {
  test('basic comma-delimited', () => {
    const result = parseCSV('a,b,c\n1,2,3')
    expect(result).toEqual([['a', 'b', 'c'], ['1', '2', '3']])
  })
  test('quoted fields with commas', () => {
    const result = parseCSV('name,note\nJohn,"Hello, world"')
    expect(result).toEqual([['name', 'note'], ['John', 'Hello, world']])
  })
  test('escaped quotes', () => {
    const result = parseCSV('a,b\n1,"He said ""Hi"""')
    expect(result).toEqual([['a', 'b'], ['1', 'He said "Hi"']])
  })
  test('semicolon delimiter', () => {
    const result = parseCSV('a;b;c\n1;2;3', ';')
    expect(result).toEqual([['a', 'b', 'c'], ['1', '2', '3']])
  })
  test('strips UTF-8 BOM', () => {
    const result = parseCSV('﻿a,b\n1,2')
    expect(result).toEqual([['a', 'b'], ['1', '2']])
  })
  test('skips blank lines', () => {
    const result = parseCSV('a,b\n\n1,2\n\n')
    expect(result).toEqual([['a', 'b'], ['1', '2']])
  })
})

describe('sniffDelimiter', () => {
  test('comma when both present', () => {
    expect(sniffDelimiter('a,b;c')).toBe(',')
  })
  test('comma when only comma', () => {
    expect(sniffDelimiter('a,b,c')).toBe(',')
  })
  test('semicolon when only semicolon', () => {
    expect(sniffDelimiter('a;b;c')).toBe(';')
  })
  test('comma when neither', () => {
    expect(sniffDelimiter('abc')).toBe(',')
  })
})

describe('toCents', () => {
  test('Brazilian format 1.234,56', () => {
    expect(toCents('1.234,56')).toBe(123456)
  })
  test('US format 1234.56', () => {
    expect(toCents('1234.56')).toBe(123456)
  })
  test('integer 1234', () => {
    expect(toCents('1234')).toBe(123400)
  })
  test('with R$ prefix', () => {
    expect(toCents('R$ 50')).toBe(5000)
    expect(toCents('R$ 1.234,56')).toBe(123456)
  })
  test('negative', () => {
    expect(toCents('-50')).toBe(-5000)
    expect(toCents('-1.234,56')).toBe(-123456)
  })
  test('zero returns null', () => {
    expect(toCents('0')).toBeNull()
    expect(toCents('0,00')).toBeNull()
  })
  test('empty returns null', () => {
    expect(toCents('')).toBeNull()
    expect(toCents('   ')).toBeNull()
  })
  test('garbage returns null', () => {
    expect(toCents('abc')).toBeNull()
  })
})

describe('toIsoDate', () => {
  test('ISO format passes through', () => {
    expect(toIsoDate('2026-07-01')).toBe('2026-07-01')
  })
  test('DD/MM/YYYY', () => {
    expect(toIsoDate('01/07/2026')).toBe('2026-07-01')
  })
  test('D/M/YY', () => {
    expect(toIsoDate('1/7/26')).toBe('2026-07-01')
  })
  test('DD/MM/YY', () => {
    expect(toIsoDate('15/12/26')).toBe('2026-12-15')
  })
  test('invalid format returns null', () => {
    expect(toIsoDate('2026/07/01')).toBeNull()
    expect(toIsoDate('garbage')).toBeNull()
    expect(toIsoDate('32/13/2026')).toBeNull()
  })
})

describe('toTime', () => {
  test('normalizes to HH:MM', () => {
    expect(toTime('14:32')).toBe('14:32')
    expect(toTime('9:05')).toBe('09:05')
    expect(toTime('23:59:59')).toBe('23:59')
  })
  test('rejects invalid', () => {
    for (const raw of ['24:00', '12:60', '1432', 'meio-dia']) expect(toTime(raw)).toBeNull()
  })
})

describe('normalizeForMatch', () => {
  test('trim and lowercase', () => {
    expect(normalizeForMatch('  Hello  ')).toBe('hello')
  })
  test('accent removal', () => {
    expect(normalizeForMatch('Café')).toBe('cafe')
    expect(normalizeForMatch('São Paulo')).toBe('sao paulo')
  })
})

describe('normalizeHeader', () => {
  test('pt-BR header', () => {
    const map = normalizeHeader(['data', 'valor', 'categoria', 'conta', 'nota'])
    expect(map.get('data')).toBe(0)
    expect(map.get('valor')).toBe(1)
    expect(map.get('categoria')).toBe(2)
    expect(map.get('conta')).toBe(3)
    expect(map.get('nota')).toBe(4)
  })
  test('time column', () => {
    expect(normalizeHeader(['data', 'hora', 'valor']).get('hora')).toBe(1)
    expect(normalizeHeader(['date', 'time', 'amount']).get('hora')).toBe(1)
  })
  test('English header', () => {
    const map = normalizeHeader(['date', 'amount', 'category', 'account', 'note'])
    expect(map.get('data')).toBe(0)
    expect(map.get('valor')).toBe(1)
    expect(map.get('categoria')).toBe(2)
    expect(map.get('conta')).toBe(3)
    expect(map.get('nota')).toBe(4)
  })
  test('case insensitive', () => {
    const map = normalizeHeader(['DATA', 'VALOR'])
    expect(map.get('data')).toBe(0)
    expect(map.get('valor')).toBe(1)
  })
  test('ignores unknown columns', () => {
    const map = normalizeHeader(['data', 'unknown', 'valor'])
    expect(map.get('data')).toBe(0)
    expect(map.get('valor')).toBe(2)
    expect(map.has('unknown')).toBe(false)
  })
})

describe('dupKey', () => {
  test('generates key', () => {
    expect(dupKey('2026-07-01', 'earn', 10000)).toBe('2026-07-01|earn|10000')
  })
})
