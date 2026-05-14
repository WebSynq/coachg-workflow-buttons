import { describe, expect, it } from 'vitest'
import {
  buttonCreateSchema,
  buttonUpdateSchema,
  buttonReorderSchema,
  enrollSchema,
  logQuerySchema,
} from './validation'

const ok = {
  label: 'SOA',
  color: '#FF0000',
  workflowId: 'wf-1',
  workflowName: 'Send SOA',
  sendsSoa: true,
}

describe('buttonCreateSchema', () => {
  it('accepts the documented happy path', () => {
    const result = buttonCreateSchema.safeParse(ok)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toEqual(ok)
  })

  it('defaults sendsSoa to true when omitted', () => {
    const { sendsSoa: _, ...rest } = ok
    void _
    const result = buttonCreateSchema.safeParse(rest)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.sendsSoa).toBe(true)
  })

  it('rejects an empty label', () => {
    expect(buttonCreateSchema.safeParse({ ...ok, label: '' }).success).toBe(false)
  })

  it('rejects a label longer than 50 chars', () => {
    expect(buttonCreateSchema.safeParse({ ...ok, label: 'x'.repeat(51) }).success).toBe(false)
  })

  it('rejects a malformed color', () => {
    expect(buttonCreateSchema.safeParse({ ...ok, color: 'red' }).success).toBe(false)
    expect(buttonCreateSchema.safeParse({ ...ok, color: '#F00' }).success).toBe(false)
    expect(buttonCreateSchema.safeParse({ ...ok, color: '#GGGGGG' }).success).toBe(false)
  })

  it('rejects an empty workflowId or workflowName', () => {
    expect(buttonCreateSchema.safeParse({ ...ok, workflowId: '' }).success).toBe(false)
    expect(buttonCreateSchema.safeParse({ ...ok, workflowName: '' }).success).toBe(false)
  })

  it('rejects unknown keys (strict)', () => {
    expect(
      buttonCreateSchema.safeParse({ ...ok, locationId: 'sneaky' }).success,
    ).toBe(false)
  })
})

describe('buttonUpdateSchema', () => {
  it('requires every editable field (no partials in PUT)', () => {
    expect(buttonUpdateSchema.safeParse(ok).success).toBe(true)
    const { sendsSoa: _, ...partial } = ok
    void _
    expect(buttonUpdateSchema.safeParse(partial).success).toBe(false)
  })

  it('applies the same constraints as create', () => {
    expect(
      buttonUpdateSchema.safeParse({ ...ok, color: 'not-a-color' }).success,
    ).toBe(false)
  })
})

describe('buttonReorderSchema', () => {
  it('accepts a non-empty array of {id, sortOrder}', () => {
    const result = buttonReorderSchema.safeParse({
      items: [
        { id: 'a1b2c3d4-e5f6-4789-9abc-1a2b3c4d5e6f', sortOrder: 0 },
        { id: 'b1b2c3d4-e5f6-4789-9abc-1a2b3c4d5e6f', sortOrder: 1 },
      ],
    })
    expect(result.success).toBe(true)
  })

  it('rejects an empty items array', () => {
    expect(buttonReorderSchema.safeParse({ items: [] }).success).toBe(false)
  })

  it('rejects a non-uuid id', () => {
    expect(
      buttonReorderSchema.safeParse({
        items: [{ id: 'not-a-uuid', sortOrder: 0 }],
      }).success,
    ).toBe(false)
  })

  it('rejects a negative sortOrder', () => {
    expect(
      buttonReorderSchema.safeParse({
        items: [{ id: 'a1b2c3d4-e5f6-4789-9abc-1a2b3c4d5e6f', sortOrder: -1 }],
      }).success,
    ).toBe(false)
  })

  it('rejects a non-integer sortOrder', () => {
    expect(
      buttonReorderSchema.safeParse({
        items: [{ id: 'a1b2c3d4-e5f6-4789-9abc-1a2b3c4d5e6f', sortOrder: 1.5 }],
      }).success,
    ).toBe(false)
  })
})

describe('enrollSchema', () => {
  const goodId = 'a1b2c3d4-e5f6-4789-9abc-1a2b3c4d5e6f'

  it('accepts the documented happy path with all fields', () => {
    const r = enrollSchema.safeParse({
      buttonId: goodId,
      contactId: 'ctc-1',
      contactName: 'Jane Doe',
    })
    expect(r.success).toBe(true)
  })

  it('accepts when contactName is omitted (DB column is nullable)', () => {
    const r = enrollSchema.safeParse({ buttonId: goodId, contactId: 'ctc-1' })
    expect(r.success).toBe(true)
  })

  it('rejects a non-uuid buttonId', () => {
    expect(
      enrollSchema.safeParse({ buttonId: 'not-a-uuid', contactId: 'c' }).success,
    ).toBe(false)
  })

  it('rejects an empty contactId', () => {
    expect(
      enrollSchema.safeParse({ buttonId: goodId, contactId: '' }).success,
    ).toBe(false)
  })

  it('rejects unknown keys (strict)', () => {
    expect(
      enrollSchema.safeParse({
        buttonId: goodId,
        contactId: 'c',
        locationId: 'sneaky',
      }).success,
    ).toBe(false)
  })
})

describe('logQuerySchema', () => {
  it('parses string limit/offset (z.coerce) from URL query params', () => {
    const r = logQuerySchema.safeParse({ limit: '50', offset: '100' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data).toEqual({ limit: 50, offset: 100 })
  })

  it('defaults limit=20 and offset=0 when both omitted', () => {
    const r = logQuerySchema.safeParse({})
    expect(r.success).toBe(true)
    if (r.success) expect(r.data).toEqual({ limit: 20, offset: 0 })
  })

  it('accepts an optional contactId', () => {
    const r = logQuerySchema.safeParse({ contactId: 'ctc-1' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.contactId).toBe('ctc-1')
  })

  it('rejects a negative offset', () => {
    expect(logQuerySchema.safeParse({ offset: '-1' }).success).toBe(false)
  })

  it('rejects limit > 100', () => {
    expect(logQuerySchema.safeParse({ limit: '101' }).success).toBe(false)
  })

  it('rejects limit < 1', () => {
    expect(logQuerySchema.safeParse({ limit: '0' }).success).toBe(false)
  })

  it('rejects an empty-string contactId', () => {
    expect(logQuerySchema.safeParse({ contactId: '' }).success).toBe(false)
  })
})
