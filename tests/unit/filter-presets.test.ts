// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_FILTER_STATE } from '@/lib/filters'
import { deletePreset, loadPresets, PRESETS_KEY, savePreset, type FilterPreset } from '@/lib/filter-presets'

const preset: FilterPreset = {
  id: 'one', name: 'Morning', createdAt: '2030-01-01T00:00:00.000Z',
  filters: { ...DEFAULT_FILTER_STATE, search: 'team', tagId: 7 },
}
beforeEach(() => { localStorage.clear(); vi.spyOn(console, 'error').mockImplementation(() => {}) })
afterEach(() => vi.restoreAllMocks())

describe('filter presets', () => {
  it('round-trips every dimension and deletes only the selected preset', () => {
    expect(loadPresets()).toEqual([])
    expect(savePreset(preset)).toEqual([preset])
    savePreset({ ...preset, id: 'two' })
    expect(loadPresets()).toEqual([preset, { ...preset, id: 'two' }])
    expect(deletePreset('one')).toEqual([{ ...preset, id: 'two' }])
    expect(loadPresets()).toEqual([{ ...preset, id: 'two' }])
  })
  it.each(['{', '{}', '[null]', JSON.stringify([{ ...preset, filters: {} }]),
    JSON.stringify([{ ...preset, filters: { ...preset.filters, dueDateFrom: '2030-02-30' } }]),
    JSON.stringify([{ ...preset, filters: { ...preset.filters, priority: 'urgent' } }])])(
    'rejects malformed or invalid stored data: %s', (raw) => {
      localStorage.setItem(PRESETS_KEY, raw)
      expect(loadPresets()).toEqual([])
      expect(console.error).toHaveBeenCalled()
    })
  it('logs blocked reads and recovers without crashing', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    expect(loadPresets()).toEqual([])
    expect(console.error).toHaveBeenCalled()
    expect(() => savePreset(preset)).toThrow(/storage/i)
  })
  it('reports quota failures and leaves existing storage unchanged', () => {
    savePreset(preset)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    expect(() => savePreset({ ...preset, id: 'two' })).toThrow(/storage full/i)
    expect(() => deletePreset('one')).toThrow(/storage full/i)
    expect(loadPresets()).toEqual([preset])
  })
  it('reports unavailable writes and rejects blank names', () => {
    expect(() => savePreset({ ...preset, name: '  ' })).toThrow()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    expect(() => savePreset(preset)).toThrow(/storage/i)
  })
})
