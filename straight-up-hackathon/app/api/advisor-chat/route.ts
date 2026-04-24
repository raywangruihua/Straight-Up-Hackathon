import OpenAI from "openai"
import { NextResponse } from "next/server"

import { retrieveRelevantEvidence } from "@/lib/evidence"
import type {
  AdvisorChatResponse,
  AdvisorCitation,
  AdvisorGroundingStatus,
  ChatMessage,
  TrajectoryGraph,
  TrajectoryNode,
  UserProfile,
} from "@/lib/chat"

export const runtime = "nodejs"

const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini"

const responseSchema = {
  name: "advisor_chat_response",
  strict: true,
  schema: {
    type: "object",
    properties: {
      reply: {
        type: "string",
        description:
          "The assistant's reply to the user's latest advisor question.",
      },
      groundingStatus: {
        type: "string",
        enum: ["grounded", "mixed", "general"],
        description:
          "Whether the reply is mostly grounded in the retrieved local evidence, mixes that evidence with general guidance, or is general guidance only.",
      },
      evidenceIds: {
        type: "array",
        items: {
          type: "string",
        },
        description:
          "IDs of the retrieved evidence records that were genuinely used in the answer.",
      },
    },
    required: ["reply", "groundingStatus", "evidenceIds"],
    additionalProperties: false,
  },
} as const

type AdvisorChatModelOutput = {
  reply: string
  groundingStatus: AdvisorGroundingStatus
  evidenceIds: string[]
}

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY

  if (!apiKey) {
    return null
  }

  return new OpenAI({ apiKey })
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object") {
    return false
  }

  const candidate = value as Record<string, unknown>
  return (
    (candidate.role === "user" || candidate.role === "assistant") &&
    typeof candidate.content === "string"
  )
}

function sanitizeMessages(payload: unknown) {
  if (!Array.isArray(payload)) {
    return [] as ChatMessage[]
  }

  return payload.filter(isChatMessage).slice(-14)
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
    ["soon", "later", "unsure", "no"].includes(candidate.familyIntent)
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

function isAdvisorChatModelOutput(
  value: unknown
): value is AdvisorChatModelOutput {
  if (!value || typeof value !== "object") {
    return false
  }

  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.reply === "string" &&
    typeof candidate.groundingStatus === "string" &&
    ["grounded", "mixed", "general"].includes(candidate.groundingStatus) &&
    Array.isArray(candidate.evidenceIds) &&
    candidate.evidenceIds.every((item) => typeof item === "string")
  )
}

function buildParentMap(graph: TrajectoryGraph | null) {
  const parentMap = new Map<string, string>()
  for (const link of graph?.links ?? []) {
    parentMap.set(link.target, link.source)
  }
  return parentMap
}

function buildChildMap(graph: TrajectoryGraph | null) {
  const childMap = new Map<string, string[]>()
  for (const link of graph?.links ?? []) {
    const existing = childMap.get(link.source) ?? []
    existing.push(link.target)
    childMap.set(link.source, existing)
  }
  return childMap
}

function summarizeTrajectory(
  graph: TrajectoryGraph | null,
  selectedNode: TrajectoryNode | null
) {
  if (!graph) {
    return "No trajectory graph is available."
  }

  const nodeMap = new Map(graph.nodes.map((node) => [node.id, node]))
  const parentMap = buildParentMap(graph)
  const childMap = buildChildMap(graph)
  const path: string[] = []

  let currentId = selectedNode?.id
  while (currentId) {
    const node = nodeMap.get(currentId)
    if (!node) {
      break
    }
    path.unshift(node.name)
    currentId = parentMap.get(currentId)
  }

  const nextOptions = selectedNode
    ? (childMap.get(selectedNode.id) ?? [])
        .map((id) => nodeMap.get(id)?.name ?? "")
        .filter(Boolean)
    : []

  const summaryLines = [
    `- Total visible nodes: ${graph.nodes.length}`,
    `- Root node: ${graph.rootId ?? "unknown"}`,
    `- Focus node: ${graph.focusId ?? "unknown"}`,
  ]

  if (selectedNode) {
    summaryLines.push(
      `- Selected node: ${selectedNode.name} (${selectedNode.kind})`
    )
    if (path.length > 0) {
      summaryLines.push(`- Path to selected node: ${path.join(" -> ")}`)
    }
    if (nextOptions.length > 0) {
      summaryLines.push(
        `- Options branching from selected node: ${nextOptions.join(", ")}`
      )
    }
  }

  return summaryLines.join("\n")
}

function formatEvidenceForPrompt(evidence: AdvisorCitation[]) {
  if (evidence.length === 0) {
    return "No closely matching local evidence was retrieved for this question."
  }

  return evidence
    .map(
      (record) =>
        `- id=${record.id}; type=${record.sourceType}; title=${record.title}; publishDate=${record.publishDate}; pageRef=${record.pageRef}; publisher=${record.publisher ?? "unknown"}; excerpt=${record.excerpt}`
    )
    .join("\n")
}

function buildAdvisorInstructions({
  profile,
  trajectory,
  selectedNode,
  evidence,
}: {
  profile: UserProfile | null
  trajectory: TrajectoryGraph | null
  selectedNode: TrajectoryNode | null
  evidence: AdvisorCitation[]
}) {
  return `
You are a supportive advisor chat for a constellation-based life and career planning product.

Your job:
- Help the user understand their current constellation and next steps.
- Prioritize the provided local evidence when it is relevant.
- Connect the answer to the selected node and path context when that helps.
- Keep replies concise, warm, practical, and non-fear-based.

Grounding rules:
- Treat the "Retrieved local evidence" section as the only grounded evidence available in this request.
- If you use local evidence, explain the relevant facts in plain language.
- If you add reasoning or suggestions beyond that evidence, clearly signpost it inside the reply with a phrase such as "General guidance:" or "Beyond the local evidence,".
- Never imply a source supports a claim unless that claim is actually supported by the retrieved evidence.
- Do not include raw URLs.
- The UI renders source cards separately, so only return the evidence IDs that you truly used.

Profile:
- Age: ${profile?.age ?? "unknown"}
- Current job: ${profile?.currentJob ?? "unknown"}
- Family intent: ${profile?.familyIntent ?? "unknown"}

Constellation context:
${summarizeTrajectory(trajectory, selectedNode)}

Retrieved local evidence:
${formatEvidenceForPrompt(evidence)}

If no local evidence is provided, the answer should be general guidance and evidenceIds must be empty.
`.trim()
}

export async function POST(request: Request) {
  const openai = getOpenAIClient()

  if (!openai) {
    return NextResponse.json(
      {
        error:
          "OPENAI_API_KEY is missing. Add it to straight-up-hackathon/.env.local to enable advisor chat.",
      },
      { status: 500 }
    )
  }

  const body = (await request.json()) as {
    messages?: unknown
    profile?: unknown
    trajectory?: unknown
    selectedNode?: unknown
  }

  const messages = sanitizeMessages(body.messages)
  const profile = isProfile(body.profile) ? body.profile : null
  const trajectory = isTrajectoryGraph(body.trajectory) ? body.trajectory : null
  const selectedNode = isTrajectoryNode(body.selectedNode)
    ? body.selectedNode
    : null

  if (messages.length === 0) {
    return NextResponse.json(
      { error: "At least one message is required." },
      { status: 400 }
    )
  }

  const retrievedEvidence = await retrieveRelevantEvidence({
    messages,
    profile,
    trajectory,
    selectedNode,
    limit: 5,
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
    })
  )

  const response = await openai.responses.create({
    model: MODEL,
    instructions: buildAdvisorInstructions({
      profile,
      trajectory,
      selectedNode,
      evidence: evidenceForPrompt,
    }),
    input: messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
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
      { error: "OpenAI returned an unreadable advisor response. Try again." },
      { status: 502 }
    )
  }

  if (!isAdvisorChatModelOutput(parsed)) {
    return NextResponse.json(
      { error: "OpenAI returned an invalid advisor payload. Try again." },
      { status: 502 }
    )
  }

  const evidenceMap = new Map(
    evidenceForPrompt.map((record) => [record.id, record])
  )
  const citations = parsed.evidenceIds
    .map((id) => evidenceMap.get(id))
    .filter((record): record is AdvisorCitation => Boolean(record))

  const groundingStatus: AdvisorGroundingStatus =
    citations.length === 0 ? "general" : parsed.groundingStatus

  const payload: AdvisorChatResponse = {
    reply: parsed.reply,
    citations,
    groundingStatus,
  }

  return NextResponse.json(payload)
}
