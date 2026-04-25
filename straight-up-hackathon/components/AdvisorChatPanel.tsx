"use client"

import { FormEvent, useEffect, useRef, useState } from "react"

import { FAMILY_INTENT_LABELS } from "@/lib/chat"
import type {
  AdvisorChatResponse,
  AdvisorGroundingStatus,
  AdvisorMessage,
  ChatMessage,
  TrajectoryGraph,
  TrajectoryNode,
  UserProfile,
} from "@/lib/chat"

type AdvisorChatPanelProps = {
  profile: UserProfile | null
  trajectory: TrajectoryGraph | null
  selectedNode: TrajectoryNode | null
}

const GROUNDING_LABELS: Record<AdvisorGroundingStatus, string> = {
  grounded: "Grounded by local evidence",
  mixed: "Grounded + general guidance",
  general: "General guidance",
}

function buildInitialMessage(
  profile: UserProfile | null,
  selectedNode: TrajectoryNode | null
): AdvisorMessage {
  const selectedContext = selectedNode
    ? `Right now you're focused on "${selectedNode.name}". `
    : "Ask about the constellation as a whole or any node you open. "

  const profileContext = profile
    ? `I can use your profile as context too: age ${profile.age}, ${profile.currentJob}, family target age range ${FAMILY_INTENT_LABELS[profile.familyIntent]}. `
    : ""

  return {
    role: "assistant",
    content: `${selectedContext}${profileContext}I'll ground answers in the local context files when I can, and I'll say when I'm adding general guidance beyond that evidence.`,
    groundingStatus: "grounded",
  }
}

function toChatMessages(messages: AdvisorMessage[]): ChatMessage[] {
  return messages.map(({ role, content }) => ({
    role,
    content,
  }))
}

function buildQuickPrompts(selectedNode: TrajectoryNode | null) {
  if (selectedNode) {
    return [
      `Why is ${selectedNode.name} on my path?`,
      "What should I prepare for at this point?",
      "What family-planning tradeoffs should I consider here?",
    ]
  }

  return [
    "What stands out most in this constellation?",
    "What risks or tradeoffs should I plan around?",
    "Which evidence-backed family planning factors matter most?",
  ]
}

export default function AdvisorChatPanel({
  profile,
  trajectory,
  selectedNode,
}: AdvisorChatPanelProps) {
  const [messages, setMessages] = useState<AdvisorMessage[]>(() => [
    buildInitialMessage(profile, selectedNode),
  ])
  const [input, setInput] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const previousResetKeyRef = useRef<string | null>(null)

  const quickPrompts = buildQuickPrompts(selectedNode)
  const resetKey = JSON.stringify({
    rootId: trajectory?.rootId ?? null,
    nodes: trajectory?.nodes.length ?? 0,
    age: profile?.age ?? null,
    currentJob: profile?.currentJob ?? "",
    familyIntent: profile?.familyIntent ?? null,
  })

  useEffect(() => {
    if (previousResetKeyRef.current === resetKey) {
      return
    }

    previousResetKeyRef.current = resetKey
    setMessages([buildInitialMessage(profile, selectedNode)])
    setInput("")
    setError(null)
  }, [resetKey, profile, selectedNode])

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    })
  }, [messages, isSubmitting])

  async function submitQuestion(question: string) {
    const trimmedQuestion = question.trim()
    if (!trimmedQuestion || isSubmitting || !trajectory) {
      return
    }

    const nextMessages = [
      ...messages,
      { role: "user" as const, content: trimmedQuestion },
    ]
    setMessages(nextMessages)
    setInput("")
    setIsSubmitting(true)
    setError(null)

    try {
      const response = await fetch("/api/advisor-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: toChatMessages(nextMessages),
          profile,
          trajectory,
          selectedNode,
        }),
      })

      const data = (await response.json()) as
        | AdvisorChatResponse
        | { error: string }
      if (!response.ok || "error" in data) {
        throw new Error(
          "error" in data ? data.error : "Advisor chat request failed."
        )
      }

      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: data.reply,
          citations: data.citations,
          groundingStatus: data.groundingStatus,
        },
      ])
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : "Something went wrong while contacting the advisor chat."
      setError(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await submitQuestion(input)
  }

  return (
    <aside className="absolute top-0 right-0 bottom-0 z-10 flex h-full w-[clamp(360px,30vw,500px)] max-w-full flex-col overflow-hidden border-l border-white/10 bg-slate-950/85 backdrop-blur-xl">
      <div className="border-b border-white/10 px-5 py-4">
        <p className="text-[11px] font-medium tracking-[0.22em] text-sky-200/70 uppercase">
          Advisor chat
        </p>
        <h2 className="mt-2 text-2xl font-semibold text-white">
          Grounded constellation guide
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          Ask about the selected node, your wider trajectory, or what
          evidence-backed planning factors to keep in view.
        </p>
        {selectedNode ? (
          <div className="mt-4 rounded-xl border border-sky-300/25 bg-sky-300/10 px-4 py-3 text-sm text-sky-50">
            <p className="text-[11px] font-medium tracking-[0.22em] text-sky-100/75 uppercase">
              Selected node
            </p>
            <p className="mt-1 font-medium">{selectedNode.name}</p>
          </div>
        ) : null}
      </div>

      <div
        ref={scrollRef}
        className="flex-1 space-y-4 overflow-y-auto px-5 py-5"
      >
        <div className="flex flex-wrap gap-2">
          {quickPrompts.map((prompt) => (
            <button
              key={prompt}
              onClick={() => setInput(prompt)}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-left text-xs text-slate-200 transition hover:bg-white/10"
              type="button"
            >
              {prompt}
            </button>
          ))}
        </div>

        {messages.map((message, index) => {
          const isAssistant = message.role === "assistant"
          const groundingStatus = message.groundingStatus ?? "general"

          return (
            <div
              key={`${message.role}-${index}`}
              className={isAssistant ? "" : "flex justify-end"}
            >
              <div
                className={`max-w-[92%] rounded-2xl px-4 py-3 text-sm leading-6 shadow-lg ${
                  isAssistant
                    ? "rounded-bl-md bg-white/10 text-slate-100"
                    : "rounded-br-md bg-sky-300 text-slate-950"
                }`}
              >
                <p>{message.content}</p>
                {isAssistant ? (
                  <p className="mt-3 text-[10px] font-medium tracking-[0.22em] text-sky-100/70 uppercase">
                    {GROUNDING_LABELS[groundingStatus]}
                  </p>
                ) : null}
                {isAssistant &&
                message.citations &&
                message.citations.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    {message.citations.map((citation) => (
                      <div
                        key={citation.id}
                        className="rounded-xl border border-white/10 bg-slate-950/45 px-3 py-3"
                      >
                        <p className="text-[10px] font-medium tracking-[0.22em] text-sky-100/70 uppercase">
                          {citation.sourceType === "curated"
                            ? "Curated source"
                            : "MOM PDF snippet"}
                        </p>
                        <p className="mt-1 font-medium text-white">
                          {citation.title}
                        </p>
                        <p className="mt-1 text-xs text-slate-300">
                          {citation.pageRef}
                          {citation.publishDate !== "unknown"
                            ? ` - ${citation.publishDate}`
                            : ""}
                        </p>
                        <p className="mt-2 text-xs leading-5 text-slate-300">
                          {citation.excerpt}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          )
        })}

        {isSubmitting ? (
          <div className="max-w-[92%] rounded-2xl rounded-bl-md bg-white/10 px-4 py-3 text-sm text-slate-300">
            Reviewing your question against the local evidence...
          </div>
        ) : null}
      </div>

      <div className="border-t border-white/10 px-5 py-4">
        {error ? (
          <div className="mb-4 rounded-xl border border-rose-300/25 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
            {error}
          </div>
        ) : null}

        <form className="flex gap-3" onSubmit={handleSubmit}>
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask about this path, a node, or the planning evidence..."
            className="min-h-24 flex-1 resize-none rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-400 focus:border-sky-300/50"
          />
          <button
            type="submit"
            disabled={isSubmitting || input.trim().length === 0 || !trajectory}
            className="h-10 self-end rounded-xl bg-sky-300 px-4 text-sm font-semibold text-slate-950 transition hover:bg-sky-200 disabled:cursor-not-allowed disabled:bg-slate-600 disabled:text-slate-300"
          >
            Send
          </button>
        </form>
      </div>
    </aside>
  )
}
