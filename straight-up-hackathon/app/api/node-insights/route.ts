import OpenAI from "openai"
import { NextResponse } from "next/server"

import { retrieveRelevantEvidence } from "@/lib/evidence"
import { FAMILY_INTENT_VALUES, FAMILY_INTENT_LABELS } from "@/lib/chat"
import type {
  AdvisorCitation,
  FamilyIntent,
  NodeIndicator,
  NodeInsights,
  TrajectoryGraph,
  TrajectoryNode,
  UserProfile,
} from "@/lib/chat"

export const runtime = "nodejs"

const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini"
const YEARS_PER_STEP = 2.5
const SG_RETIREMENT_AGE = 65

const indicatorSchema = {
  type: "object",
  properties: {
    value: { type: "number" },
    reasoning: { type: "string" },
    citedEvidenceIds: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["value", "reasoning", "citedEvidenceIds"],
  additionalProperties: false,
} as const

const responseSchema = {
  name: "node_insights_response",
  strict: true,
  schema: {
    type: "object",
    properties: {
      ageEstimate: indicatorSchema,
      fertilityRisk: indicatorSchema,
      careerProgression: indicatorSchema,
    },
    required: ["ageEstimate", "fertilityRisk", "careerProgression"],
    additionalProperties: false,
  },
} as const

type NodeInsightsModelOutput = {
  ageEstimate: NodeIndicator
  fertilityRisk: NodeIndicator
  careerProgression: NodeIndicator
}

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return null
  }
  return new OpenAI({ apiKey })
}

function isProfile(value: unknown): value is UserProfile {
  if (!value || typeof value !== "object") {
    return false
  }
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.age === "number" &&
    Number.isInteger(candidate.age) &&
    typeof candidate.currentJob === "string" &&
    typeof candidate.familyIntent === "string" &&
    (FAMILY_INTENT_VALUES as string[]).includes(candidate.familyIntent)
  )
}

function isTrajectoryNode(value: unknown): value is TrajectoryNode {
  if (!value || typeof value !== "object") {
    return false
  }
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.description === "string" &&
    typeof candidate.level === "number" &&
    typeof candidate.x === "number" &&
    typeof candidate.y === "number" &&
    ["history", "prediction", "planning", "decision"].includes(
      String(candidate.kind)
    )
  )
}

function isTrajectoryGraph(value: unknown): value is TrajectoryGraph {
  if (!value || typeof value !== "object") {
    return false
  }
  const candidate = value as Record<string, unknown>
  return (
    Array.isArray(candidate.nodes) &&
    Array.isArray(candidate.links) &&
    (candidate.rootId === null || typeof candidate.rootId === "string") &&
    (candidate.focusId === null || typeof candidate.focusId === "string")
  )
}

function isIndicator(value: unknown): value is NodeIndicator {
  if (!value || typeof value !== "object") {
    return false
  }
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.value === "number" &&
    typeof candidate.reasoning === "string" &&
    Array.isArray(candidate.citedEvidenceIds) &&
    candidate.citedEvidenceIds.every((id) => typeof id === "string")
  )
}

function isModelOutput(value: unknown): value is NodeInsightsModelOutput {
  if (!value || typeof value !== "object") {
    return false
  }
  const candidate = value as Record<string, unknown>
  return (
    isIndicator(candidate.ageEstimate) &&
    isIndicator(candidate.fertilityRisk) &&
    isIndicator(candidate.careerProgression)
  )
}

function buildParentMap(graph: TrajectoryGraph | null) {
  const parentMap = new Map<string, string>()
  for (const link of graph?.links ?? []) {
    parentMap.set(link.target, link.source)
  }
  return parentMap
}

function pathToNode(
  graph: TrajectoryGraph | null,
  selectedNode: TrajectoryNode | null
) {
  if (!graph || !selectedNode) {
    return [] as TrajectoryNode[]
  }
  const nodeMap = new Map(graph.nodes.map((node) => [node.id, node]))
  const parentMap = buildParentMap(graph)
  const path: TrajectoryNode[] = []
  let currentId: string | undefined = selectedNode.id
  while (currentId) {
    const node = nodeMap.get(currentId)
    if (!node) {
      break
    }
    path.unshift(node)
    currentId = parentMap.get(currentId)
  }
  return path
}

function estimateAgeBaseline(
  profile: UserProfile,
  path: TrajectoryNode[]
): { estimatedAge: number; stepsFromCurrent: number } {
  // Walk the path and count prediction/planning/decision steps *after* the
  // last history node. Decision + planning nodes are conceptual branches,
  // not time-advancing events, so only prediction steps add years.
  const lastHistoryIndex = path.map((node) => node.kind).lastIndexOf("history")
  const tailing = lastHistoryIndex >= 0 ? path.slice(lastHistoryIndex + 1) : path
  const predictionSteps = tailing.filter(
    (node) => node.kind === "prediction"
  ).length
  return {
    estimatedAge: Math.round(profile.age + predictionSteps * YEARS_PER_STEP),
    stepsFromCurrent: predictionSteps,
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function formatEvidenceForPrompt(evidence: AdvisorCitation[]) {
  if (evidence.length === 0) {
    return "No closely matching local evidence was retrieved for this node."
  }
  return evidence
    .map(
      (record) =>
        `- id=${record.id}; type=${record.sourceType}; title=${record.title}; publishDate=${record.publishDate}; pageRef=${record.pageRef}; publisher=${record.publisher ?? "unknown"}; excerpt=${record.excerpt}`
    )
    .join("\n")
}

function buildInstructions({
  profile,
  selectedNode,
  pathNames,
  ageBaseline,
  stepsFromCurrent,
  evidence,
}: {
  profile: UserProfile
  selectedNode: TrajectoryNode
  pathNames: string[]
  ageBaseline: number
  stepsFromCurrent: number
  evidence: AdvisorCitation[]
}) {
  return `
You produce three quantitative indicators for a career/life planning product.

For each indicator, return:
- value: a number in the specified range
- reasoning: 2-3 concise sentences. State the headline finding, then briefly
  name the inputs you used (age anchors, role cues, baseline math) and any
  caveat that would shift the value most. Be tight — no filler, no
  restating the indicator definition. Do not exceed 3 sentences.
- citedEvidenceIds: IDs from the provided evidence that genuinely informed the reasoning (may be empty)

Indicator definitions:
1. ageEstimate (value: integer years)
   - Best estimate of the user's age when they reach the selected node.
   - A deterministic baseline has been pre-computed for you: ${ageBaseline} years
     (current age ${profile.age} + ${stepsFromCurrent} prediction step(s) x ${YEARS_PER_STEP} yrs/step).
   - You may deviate +/- 2 years only if the selected node's name strongly suggests
     an unusually fast/slow transition (e.g. leadership, re-entry, pivot). Otherwise stick to the baseline.

2. fertilityRisk (value: 0-100, higher = more likely that trying to conceive at that age encounters biological difficulty)
   - Population-level reference, not individual diagnosis. Use these age anchors
     (widely cited clinical baselines):
       <30: ~15-20
       30-34: ~25-35
       35-37: ~45-55
       38-39: ~60-70
       40-42: ~75-85
       43+: ~88-95
   - Interpolate for the estimated age above. If the node is a "Family Planning"
     or re-entry milestone, keep the score grounded at the estimated age, not shifted.
   - You may cite local fertility baseline evidence if provided (e.g. Singapore TFR).
     Those are population context, not individual risk; still allowed to cite.

3. careerProgression (value: 0-100, where 0 = just starting out and 100 = peak/retirement)
   - Baseline: normalize estimatedAge onto a 22..${SG_RETIREMENT_AGE} scale, i.e.
     percent ~= clamp((estimatedAge - 22) / (${SG_RETIREMENT_AGE} - 22) * 100, 0, 100).
   - Adjust by the selected node's role seniority: junior/entry keywords pull down,
     senior/lead/director/principal/partner/chief/executive keywords pull up (~+10 to +20).
   - If the selected node is a planning/decision/family-planning milestone, return the
     progression implied by the estimated age alone (no role adjustment).

Be conservative. If uncertain, round toward the deterministic baseline.

User profile:
- Age: ${profile.age}
- Current job: ${profile.currentJob}
- Family planning target age range: ${FAMILY_INTENT_LABELS[profile.familyIntent as FamilyIntent]}

Selected node:
- Name: ${selectedNode.name}
- Kind: ${selectedNode.kind}
- Description: ${selectedNode.description || "(no description)"}

Path from start to selected node:
${pathNames.map((name, index) => `  ${index + 1}. ${name}`).join("\n") || "  (empty)"}

Retrieved local evidence (may be empty):
${formatEvidenceForPrompt(evidence)}

Only cite evidence IDs that appear above. If none apply, return an empty array for that indicator.
`.trim()
}

export async function POST(request: Request) {
  const openai = getOpenAIClient()
  if (!openai) {
    return NextResponse.json(
      {
        error:
          "OPENAI_API_KEY is missing. Add it to straight-up-hackathon/.env.local to enable node insights.",
      },
      { status: 500 }
    )
  }

  const body = (await request.json()) as {
    profile?: unknown
    trajectory?: unknown
    selectedNode?: unknown
  }

  const profile = isProfile(body.profile) ? body.profile : null
  const trajectory = isTrajectoryGraph(body.trajectory) ? body.trajectory : null
  const selectedNode = isTrajectoryNode(body.selectedNode)
    ? body.selectedNode
    : null

  if (!profile || !selectedNode) {
    return NextResponse.json(
      { error: "profile and selectedNode are required." },
      { status: 400 }
    )
  }

  const path = pathToNode(trajectory, selectedNode)
  const pathNames = path.map((node) => node.name)
  const { estimatedAge, stepsFromCurrent } = estimateAgeBaseline(profile, path)

  // Seed the retrieval with the same helper used by advisor-chat, but shape
  // the "messages" input as a synthetic user question framed around the node
  // so the keyword/theme matching picks up relevant corpus entries.
  const syntheticQuestion = `At age ${estimatedAge}, reaching "${selectedNode.name}". What Singapore labour, fertility, leave, childcare, and housing context is relevant?`
  const retrievedEvidence = await retrieveRelevantEvidence({
    messages: [{ role: "user", content: syntheticQuestion }],
    profile,
    trajectory,
    selectedNode,
    limit: 6,
  })

  const evidenceForPrompt: AdvisorCitation[] = retrievedEvidence.map(
    (record) => ({
      id: record.id,
      sourceId: record.sourceId,
      title: record.title,
      publishDate: record.publishDate,
      pageRef: record.pageRef,
      excerpt: record.excerpt,
      sourceType: record.sourceType,
      publisher: record.publisher,
      sourceFile: record.sourceFile,
      url: record.url,
    })
  )

  const response = await openai.responses.create({
    model: MODEL,
    instructions: buildInstructions({
      profile,
      selectedNode,
      pathNames,
      ageBaseline: estimatedAge,
      stepsFromCurrent,
      evidence: evidenceForPrompt,
    }),
    input: syntheticQuestion,
    text: {
      format: {
        type: "json_schema",
        ...responseSchema,
      },
    },
  })

  let parsed: unknown
  try {
    parsed = JSON.parse(response.output_text)
  } catch {
    return NextResponse.json(
      { error: "OpenAI returned an unreadable insights payload. Try again." },
      { status: 502 }
    )
  }

  if (!isModelOutput(parsed)) {
    return NextResponse.json(
      { error: "OpenAI returned an invalid insights payload. Try again." },
      { status: 502 }
    )
  }

  const evidenceMap = new Map(
    evidenceForPrompt.map((record) => [record.id, record])
  )

  const filterCited = (indicator: NodeIndicator): NodeIndicator => ({
    value: indicator.value,
    reasoning: indicator.reasoning,
    citedEvidenceIds: indicator.citedEvidenceIds.filter((id) =>
      evidenceMap.has(id)
    ),
  })

  const clampedAge = Math.round(clamp(parsed.ageEstimate.value, 0, 120))
  const clampedFertility = clamp(parsed.fertilityRisk.value, 0, 100)
  const clampedCareer = clamp(parsed.careerProgression.value, 0, 100)

  const usedIds = new Set<string>([
    ...filterCited(parsed.ageEstimate).citedEvidenceIds,
    ...filterCited(parsed.fertilityRisk).citedEvidenceIds,
    ...filterCited(parsed.careerProgression).citedEvidenceIds,
  ])

  const citations = evidenceForPrompt.filter((record) => usedIds.has(record.id))

  const payload: NodeInsights = {
    ageEstimate: { ...filterCited(parsed.ageEstimate), value: clampedAge },
    fertilityRisk: {
      ...filterCited(parsed.fertilityRisk),
      value: clampedFertility,
    },
    careerProgression: {
      ...filterCited(parsed.careerProgression),
      value: clampedCareer,
    },
    citations,
  }

  return NextResponse.json(payload)
}
