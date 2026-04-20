export type LearningStatus = 'short' | 'long' | null

export type TranslationCard = {
  id: number
  source_text: string
  target_text: string
  examples_html: string | null
  learning_status: LearningStatus
  learning_days_remaining: number | null
}

export const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? ''
