import OpenAI from "openai"
import { NextResponse } from "next/server"

import type { ChatMessage, UserProfile } from "@/lib/chat"

const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini"

const systemPrompt = `
You are a supportive planning assistant for a life-design product.

Your goals:
- Gather three profile fields: age, current job, and family intent.
- Family intent must be one of: soon, later, unsure, no.
- Ask only for the missing information.
- Keep replies concise, warm, and empowering.
- Avoid fear-based framing.
- Once all three fields are known, return complete=true and a fully populated profile.
- If any field is still missing, return complete=false and profile=null.
`

const responseSchema = {
  name: "chat_intake_response",
  strict: true,
  schema: {
    type: "object",
    properties: {
      reply: {
        type: "string",
        description: "The assistant's next conversational reply to the user.",
      },
      complete: {
        type: "boolean",
        description: "Whether all required profile fields have been gathered.",
      },
      profile: {
        anyOf: [
          {
            type: "object",
            properties: {
              age: {
                type: "integer",
                description: "The user's age in whole years.",
              },
              currentJob: {
                type: "string",
                description: "The user's current job title in plain language.",
              },
              familyIntent: {
                type: "string",
                enum: ["soon", "later", "unsure", "no"],
                description:
                  "Whether the user wants to start a family soon, later, is unsure, or does not want children.",
              },
            },
            required: ["age", "currentJob", "familyIntent"],
            additionalProperties: false,
          },
          {
            type: "null",
          },
        ],
      },
    },
    required: ["reply", "complete", "profile"],
    additionalProperties: false,
  },
} as const

type OpenAIChatResponse = {
  reply: string
  complete: boolean
  profile: UserProfile | null
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
    return []
  }

  return payload.filter(isChatMessage).slice(-12)
}

function isProfile(value: unknown): value is UserProfile {
  if (!value || typeof value !== "object") {
    return false
  }

  const candidate = value as Record<string, unknown>
  const familyIntent = candidate.familyIntent

  return (
    typeof candidate.age === "number" &&
    Number.isInteger(candidate.age) &&
    typeof candidate.currentJob === "string" &&
    typeof familyIntent === "string" &&
    ["soon", "later", "unsure", "no"].includes(familyIntent)
  )
}

function isOpenAIChatResponse(value: unknown): value is OpenAIChatResponse {
  if (!value || typeof value !== "object") {
    return false
  }

  const candidate = value as Record<string, unknown>

  if (
    typeof candidate.reply !== "string" ||
    typeof candidate.complete !== "boolean"
  ) {
    return false
  }

  if (candidate.profile === null) {
    return true
  }

  return isProfile(candidate.profile)
}

export async function POST(request: Request) {
  const openai = getOpenAIClient()

  if (!openai) {
    return NextResponse.json(
      {
        error:
          "OPENAI_API_KEY is missing. Add it to straight-up-hackathon/.env.local to enable chat.",
      },
      { status: 500 }
    )
  }

  const body = (await request.json()) as { messages?: unknown }
  const messages = sanitizeMessages(body.messages)

  if (messages.length === 0) {
    return NextResponse.json(
      { error: "At least one message is required." },
      { status: 400 }
    )
  }

  const response = await openai.responses.create({
    model: MODEL,
    instructions: systemPrompt,
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
      { error: "OpenAI returned an unreadable response. Try again." },
      { status: 502 }
    )
  }

  if (!isOpenAIChatResponse(parsed)) {
    return NextResponse.json(
      { error: "OpenAI returned an invalid profile payload. Try again." },
      { status: 502 }
    )
  }

  const finalProfile = parsed.complete && parsed.profile ? parsed.profile : null

  return NextResponse.json({
    reply: parsed.reply,
    profile: finalProfile,
    complete: parsed.complete,
  })
}
