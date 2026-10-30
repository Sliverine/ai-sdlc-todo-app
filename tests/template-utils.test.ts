import { describe, expect, it, vi } from 'vitest'
import {
  calculateTemplateDueDate,
  parseTemplateSubtasks,
  validateCreateTemplateDto,
} from '../lib/template-utils'

describe('template utilities', () => {
  it('round-trips valid template subtasks', () => {
    const subtasks = [
      { title: 'Draft', position: 0 },
      { title: 'Review', position: 2 },
    ]

    expect(parseTemplateSubtasks(JSON.stringify(subtasks))).toEqual(subtasks)
    expect(parseTemplateSubtasks(null)).toEqual([])
  })

  it.each(['{', '[{"title":7,"position":0}]'])('logs and ignores malformed or invalid stored JSON: %s', (raw) => {
    const logError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(parseTemplateSubtasks(raw)).toEqual([])
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('template subtasks'), expect.anything())

    logError.mockRestore()
  })

  it('calculates relative due dates from Singapore now and rejects offsets beyond valid dates', () => {
    expect(calculateTemplateDueDate(75, new Date('2026-10-30T00:00:00.000Z')))
      .toBe('2026-10-30T01:15:00.000Z')
    expect(calculateTemplateDueDate(null, new Date('2026-10-30T00:00:00.000Z'))).toBeNull()
    expect(() => calculateTemplateDueDate(1, new Date(8_640_000_000_000_000))).toThrow()
    expect(() => calculateTemplateDueDate(1, new Date('9999-12-31T23:59:59.999Z'))).toThrow()
  })

  it('validates required fields and recurrence/reminder invariants strictly', () => {
    expect(validateCreateTemplateDto({
      name: '  Weekly  ',
      title_template: '  Review  ',
    })).toMatchObject({ name: 'Weekly', title_template: 'Review' })

    expect(() => validateCreateTemplateDto({
      name: 'Missing offset',
      title_template: 'Review',
      is_recurring: true,
      recurrence_pattern: 'weekly',
    })).toThrow('Recurring templates require a due date offset and recurrence pattern')
    expect(() => validateCreateTemplateDto({
      name: 'Unknown field',
      title_template: 'Review',
      tags: [1],
    })).toThrow()
    expect(() => validateCreateTemplateDto({
      name: 'Bad offset',
      title_template: 'Review',
      due_date_offset_minutes: Number.MAX_SAFE_INTEGER,
    }, new Date('2026-10-30T00:00:00.000Z'))).toThrow()
  })
})
