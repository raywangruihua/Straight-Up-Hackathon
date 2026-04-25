"use client"

import { FormEvent, useEffect, useRef, useState } from "react"

import { FAMILY_INTENT_LABELS } from "@/lib/chat"
import type { ChatMessage, ChatResponse, UserProfile } from "@/lib/chat"

type ChatPanelProps = {
  compact?: boolean
  onProfileChange: (profile: UserProfile | null) => void
}

const INITIAL_MESSAGE: ChatMessage = {
  role: "assistant",
  content:
    "Tell me a bit about where you are now, and I will help map a realistic path. I will ask about your age, current job, and whether starting a family soon is on your mind.",
}

export default function ChatPanel({
  compact = false,
  onProfileChange,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_MESSAGE])
  const [input, setInput] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    })
  }, [messages, isSubmitting])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = input.trim()

    if (!value || isSubmitting) {
      return
    }

    const nextMessages = [
      ...messages,
      { role: "user" as const, content: value },
    ]
    setMessages(nextMessages)
    setInput("")
    setIsSubmitting(true)
    setError(null)

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages }),
      })

      const data = (await response.json()) as ChatResponse | { error: string }

      if (!response.ok || "error" in data) {
        throw new Error("error" in data ? data.error : "Chat request failed.")
      }

      setMessages((current) => [
        ...current,
        { role: "assistant", content: data.reply },
      ])
      setProfile(data.profile)
      onProfileChange(data.profile)
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : "Something went wrong while contacting OpenAI."
      setError(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <aside
      className={`relative z-10 flex w-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-950/80 backdrop-blur-xl ${
        compact ? "h-[70vh] max-w-none" : "h-[calc(100vh-3rem)] max-w-md"
      }`}
    >
      <div className="border-b border-white/10 px-5 py-4">
        <p className="text-[11px] font-medium tracking-[0.22em] text-sky-200/70 uppercase">
          Guided intake
        </p>
        <h2 className="mt-2 text-2xl font-semibold text-white">
          Career planning chat
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          OpenAI collects the profile first, then we can hand the structured
          result into the constellation builder.
        </p>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 space-y-4 overflow-y-auto px-5 py-5"
      >
        {messages.map((message, index) => {
          const isAssistant = message.role === "assistant"

          return (
            <div
              key={`${message.role}-${index}`}
              className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm leading-6 shadow-lg ${
                isAssistant
                  ? "rounded-bl-md bg-white/10 text-slate-100"
                  : "ml-auto rounded-br-md bg-sky-300 text-slate-950"
              }`}
            >
              {message.content}
            </div>
          )
        })}

        {isSubmitting ? (
          <div className="max-w-[90%] rounded-2xl rounded-bl-md bg-white/10 px-4 py-3 text-sm text-slate-300">
            Thinking...
          </div>
        ) : null}
      </div>

      <div className="border-t border-white/10 px-5 py-4">
        {profile ? (
          <div className="mb-4 rounded-xl border border-emerald-300/25 bg-emerald-300/10 px-4 py-3 text-sm text-emerald-50">
            <p className="font-medium">Structured profile captured</p>
            <p className="mt-1 text-emerald-100/85">
              Age {profile.age}, {profile.currentJob}, family target age:{" "}
              {FAMILY_INTENT_LABELS[profile.familyIntent]}
            </p>
          </div>
        ) : null}

        {error ? (
          <div className="mb-4 rounded-xl border border-rose-300/25 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
            {error}
          </div>
        ) : null}

        <form className="flex gap-3" onSubmit={handleSubmit}>
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Reply here..."
            className="min-h-24 flex-1 resize-none rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-400 focus:border-sky-300/50"
          />
          <button
            type="submit"
            disabled={isSubmitting || input.trim().length === 0}
            className="h-10 self-end rounded-xl bg-sky-300 px-4 text-sm font-semibold text-slate-950 transition hover:bg-sky-200 disabled:cursor-not-allowed disabled:bg-slate-600 disabled:text-slate-300"
          >
            Send
          </button>
        </form>
      </div>
    </aside>
  )
}
