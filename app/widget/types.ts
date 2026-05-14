export interface Button {
  id: string
  label: string
  color: string
  workflowId: string
  workflowName: string
  sortOrder: number
  sendsSoa: boolean
}

export interface LogEntry {
  id: string
  contactId: string
  contactName: string | null
  buttonLabel: string
  workflowId: string
  workflowName: string
  triggeredByUserId: string
  triggeredByUserName: string
  status: 'success' | 'error'
  errorMessage: string | null
  triggeredAt: string
  soaSentAt: string | null
}

export interface WidgetData {
  buttons: Button[]
  entries: LogEntry[]
  lastSoaSentAt: string | null
}
