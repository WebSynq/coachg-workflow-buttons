import { z } from 'zod'

const labelSchema = z.string().min(1).max(50)
const colorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/)
const idStringSchema = z.string().min(1)

export const buttonCreateSchema = z
  .object({
    label: labelSchema,
    color: colorSchema,
    workflowId: idStringSchema,
    workflowName: idStringSchema,
    sendsSoa: z.boolean().optional().default(true),
  })
  .strict()

export const buttonUpdateSchema = z
  .object({
    label: labelSchema,
    color: colorSchema,
    workflowId: idStringSchema,
    workflowName: idStringSchema,
    sendsSoa: z.boolean(),
  })
  .strict()

export const buttonReorderSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            id: z.uuid(),
            sortOrder: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()

export type ButtonCreateInput = z.infer<typeof buttonCreateSchema>
export type ButtonUpdateInput = z.infer<typeof buttonUpdateSchema>
export type ButtonReorderInput = z.infer<typeof buttonReorderSchema>

export const enrollSchema = z
  .object({
    buttonId: z.uuid(),
    contactId: idStringSchema,
    contactName: z.string().optional(),
  })
  .strict()
export type EnrollInput = z.infer<typeof enrollSchema>

export const logQuerySchema = z
  .object({
    contactId: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict()
export type LogQuery = z.infer<typeof logQuerySchema>
