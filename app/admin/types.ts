import type { Button } from '../widget/types'

export type AdminButton = Button

export interface Workflow {
  id: string
  name: string
}

export interface ButtonFormData {
  label: string
  color: string
  workflowId: string
  workflowName: string
  sendsSoa: boolean
}
