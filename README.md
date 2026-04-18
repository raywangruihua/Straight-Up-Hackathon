# Constellation.ai

## Problem Statement: The Fertility Window VS Career Acceleration Dilemma

Young women face rising pressure to optimise career early while managing long-term biological trade-offs. The system forces a  choice it never asks of men.

How might we build decision-support tools that give young women realistic, empowering data about long-term life planning without fear-based narratives?

## Solution

A career adviser application that shows possible career progressions with an emphasis on optimising feritility window, child raising and career.

## Description

How is the life constellation created?

Considerations

1. Different age groups have different priorities
2. Focus on the tech sector for now

Features

1. Chatbot to query for user information, it must ask these questions:
   1. What is your age?
   2. What is your current job?
   3. Are you interested in starting a family soon?
2. Creates a possible timelines with milestones

## Plan

### Tech Stack

- **Frontend:** Next.js 15 (App Router) + TypeScript + Tailwind CSS
- **AI Backend:** Claude API (`claude-sonnet-4-6`) via Anthropic SDK — multi-turn chat with tool use to extract structured user data, served via Next.js Route Handlers (`/app/api/chat/route.ts`)
- **Visualisation:** D3.js or Recharts for the interactive timeline/constellation view
- **State management:** Zustand (lightweight, no boilerplate)
- **Hosting:** Vercel — unified deployment, no separate backend needed

---

### Architecture

```text
Next.js App (App Router)
  │
  ├── app/page.tsx                — root page, composes layout
  ├── app/components/
  │     ├── ChatPanel             — multi-turn conversational UI (Client Component)
  │     │     └── calls POST /api/chat  (streaming SSE)
  │     └── ConstellationView     — renders timeline with milestone nodes (Client Component)
  │           └── reads ConstellationData from Zustand store
  │
  ├── Zustand store               — holds chatHistory, userProfile, constellationData
  │
  └── app/api/chat/route.ts       — Next.js Route Handler (Edge Runtime)
        ├── Maintains conversation history per session (cookie/token)
        ├── Calls Claude API with a system prompt that instructs it to:
        │     1. Ask the three required questions (age, current job, family plans)
        │     2. Use a `submit_profile` tool call when all answers are collected
        │     3. Stream follow-up advice tailored to user profile
        └── On tool call → ConstellationBuilder generates milestone timeline JSON
              and returns it alongside the assistant reply
```

---

### Key Components

| Component | Responsibility |
| --- | --- |
| `ChatPanel` | Renders message bubbles, input box, sends messages to `/api/chat` |
| `ConstellationView` | SVG/canvas timeline — career nodes (promotions, skill milestones) and life nodes (fertility window, parental leave, child age gates) rendered as a constellation |
| `ConstellationBuilder` | Pure function: takes `UserProfile` → returns `ConstellationData` (array of dated milestone nodes with type, label, and position) |
| `useChat` hook | Manages streaming response, appends tokens, triggers constellation update on tool call |
| `/api/chat` route | Serverless function: proxies to Claude API, handles `submit_profile` tool, builds constellation |

---

### Data Models

```ts
type UserProfile = {
  age: number;
  currentJob: string;          // e.g. "Junior Software Engineer"
  familyIntent: "soon" | "later" | "unsure" | "no";
};

type Milestone = {
  id: string;
  year: number;                // absolute year (currentYear + offset)
  type: "career" | "fertility" | "family" | "personal";
  label: string;
  description: string;
  isOptimal?: boolean;         // highlight the recommended window
};

type ConstellationData = {
  profile: UserProfile;
  milestones: Milestone[];
};
```

---

### Milestone Generation Logic (ConstellationBuilder)

1. **Career track** — map `currentJob` to a tech-sector ladder (IC1 → IC2 → Senior → Staff → Principal) with realistic year offsets per role level.
2. **Fertility window** — overlay medically-grounded fertility bands (peak: 20–30, decline gradient: 30–35, steep: 35+) as background shading on the timeline.
3. **Family planning nodes** — insert "Parental Leave", "Return to Work", "Child starts school" nodes offset from a chosen birth year.
4. **Optimisation hints** — flag career milestones that land inside the fertility peak window as `isOptimal: true` to give an empowering, non-fear-based framing.

---

### Implementation Steps

1. **Scaffold** — `npx create-next-app@latest` with TypeScript + Tailwind; add Zustand and Anthropic SDK.
2. **Claude chat Route Handler** — `app/api/chat/route.ts` using Edge Runtime for streaming SSE, with `submit_profile` tool definition; validate and parse tool call result into `UserProfile`.
3. **ChatPanel UI** — streaming message rendering, auto-scroll, loading state.
4. **ConstellationBuilder** — pure function unit-tested with sample profiles.
5. **ConstellationView** — SVG timeline: horizontal year axis, stacked swim-lanes per milestone type, node tooltips.
6. **Wire together** — on `submit_profile` tool call, store `ConstellationData` in Zustand; `ConstellationView` renders reactively.
7. **Polish** — mobile-responsive layout, accessible colour palette, positive/empowering copy review.
