export type FamilyIntent = "soon" | "later" | "unsure" | "no"

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
