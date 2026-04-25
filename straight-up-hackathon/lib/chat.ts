export type FamilyIntent =
  | "under-25"
  | "25-29"
  | "30-34"
  | "35-39"
  | "40-44"
  | "45-plus"
  | "none"

export const FAMILY_INTENT_VALUES: FamilyIntent[] = [
  "under-25",
  "25-29",
  "30-34",
  "35-39",
  "40-44",
  "45-plus",
  "none",
]

export const FAMILY_INTENT_LABELS: Record<FamilyIntent, string> = {
  "under-25": "Under 25",
  "25-29": "25-29",
  "30-34": "30-34",
  "35-39": "35-39",
  "40-44": "40-44",
  "45-plus": "45+",
  none: "Not planning",
}

const FAMILY_INTENT_RANGES: Record<FamilyIntent, [number, number] | null> = {
  "under-25": [0, 24],
  "25-29": [25, 29],
  "30-34": [30, 34],
  "35-39": [35, 39],
  "40-44": [40, 44],
  "45-plus": [45, 99],
  none: null,
}

export type FamilyIntentTiming = "soon" | "later" | "unsure" | "no"

/**
 * Translate the age-range family intent into a relative timing semantic
 * (mirrors career-predictor/main.py's `family_intent_semantic`). Lets call
 * sites keep simple "is this happening soon?" checks without re-deriving the
 * age math each time.
 */
export function familyIntentTiming(
  intent: FamilyIntent | null | undefined,
  age: number | null | undefined
): FamilyIntentTiming | null {
  if (!intent) return null
  if (intent === "none") return "no"
  const window = FAMILY_INTENT_RANGES[intent]
  if (!window) return null
  const [low, high] = window
  if (typeof age !== "number") return "unsure"
  if (age > high) return "unsure"
  const distance = Math.max(0, low - age)
  if (distance <= 5) return "soon"
  if (distance <= 15) return "later"
  return "unsure"
}

export type ChatMessage = {
  role: "user" | "assistant"
  content: string
}

export type AdvisorGroundingStatus = "grounded" | "mixed" | "general"

export type AdvisorCitation = {
  id: string
  sourceId: string
  title: string
  publishDate: string
  pageRef: string
  excerpt: string
  sourceType: "curated" | "mom_pdf"
  publisher?: string
  sourceFile?: string
  url?: string
}

export type NodeIndicator = {
  value: number
  reasoning: string
  citedEvidenceIds: string[]
}

export type NodeInsights = {
  ageEstimate: NodeIndicator
  fertilityRisk: NodeIndicator
  careerProgression: NodeIndicator
  citations: AdvisorCitation[]
}

export type AdvisorMessage = ChatMessage & {
  citations?: AdvisorCitation[]
  groundingStatus?: AdvisorGroundingStatus
}

export type UserProfile = {
  age: number
  currentJob: string
  familyIntent: FamilyIntent
}

export type ProfileDraft = {
  age: number | null
  currentJob: string
  familyIntent: FamilyIntent | null
}

export type TrajectoryNode = {
  id: string
  name: string
  description: string
  kind: "history" | "prediction" | "planning" | "decision"
  level: number
  x: number
  y: number
  decisionType?: "career" | "family"
}

export type TrajectoryLink = {
  source: string
  target: string
}

export type TrajectoryGraph = {
  nodes: TrajectoryNode[]
  links: TrajectoryLink[]
  rootId: string | null
  focusId: string | null
}

export type TrajectoryOption = {
  name: string
  description: string
  kind: "prediction" | "planning"
}

export type TrajectoryExpansion = {
  options: TrajectoryOption[]
}

export type ChatResponse = {
  reply: string
  profile: UserProfile | null
  complete: boolean
}

export type AdvisorChatResponse = {
  reply: string
  citations: AdvisorCitation[]
  groundingStatus: AdvisorGroundingStatus
}
