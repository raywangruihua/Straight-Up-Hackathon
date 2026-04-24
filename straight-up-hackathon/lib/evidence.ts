import "server-only"

import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

import type {
  AdvisorCitation,
  ChatMessage,
  TrajectoryGraph,
  TrajectoryNode,
  UserProfile,
} from "@/lib/chat"

type SourceRegistryEntry = {
  sourceId: string
  publisher?: string
  resolvedUrl?: string
  url?: string
}

type CuratedEvidenceRecord = {
  id: string
  sourceId: string
  title: string
  publishDate: string
  theme: string
  claim: string
  summary: string
  pageRef: string
  allowedUsage: string
  confidence: number
  relevance: string
}

type PdfSnippetRecord = {
  id: string
  sourceId: string
  title: string
  publishDate: string
  pageRef: string
  sourceFile: string
  text: string
  sourceType: "mom_pdf"
}

type EvidenceRecord = AdvisorCitation & {
  searchableText: string
  theme?: string
  allowedUsage?: string
  confidence?: number
  relevance?: string
  publisher?: string
  keywordSet: Set<string>
}

type EvidenceCorpus = {
  records: EvidenceRecord[]
  sourceRegistry: Map<string, SourceRegistryEntry>
}

type RetrieveEvidenceInput = {
  messages: ChatMessage[]
  profile: UserProfile | null
  trajectory?: TrajectoryGraph | null
  selectedNode?: TrajectoryNode | null
  limit?: number
}

const DATA_DIR = path.join(process.cwd(), "context_files", "data")
const CURATED_DIR = path.join(DATA_DIR, "curated")
const SNIPPETS_PATH = path.join(DATA_DIR, "snippets", "mom_pdf_snippets.json")
const SOURCE_REGISTRY_PATH = path.join(DATA_DIR, "source_registry.json")

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "do",
  "for",
  "from",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "our",
  "that",
  "the",
  "their",
  "them",
  "there",
  "these",
  "this",
  "to",
  "us",
  "was",
  "we",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
  "would",
  "you",
  "your",
])

const TOKEN_EXPANSIONS: Record<string, string[]> = {
  afford: ["cost", "budget", "subsidy", "grant", "bonus"],
  baby: ["birth", "child", "children", "infant", "bonus"],
  bonus: ["grant", "support", "benefit"],
  career: ["employment", "job", "work", "wage", "training", "mobility"],
  childcare: ["infant", "preschool", "kindergarten", "subsidy", "care"],
  child: ["baby", "children", "infant", "childcare"],
  family: ["child", "children", "fertility", "leave", "parental", "partner"],
  fertility: ["birth", "family", "childbearing"],
  grant: ["bonus", "subsidy", "support"],
  housing: ["hdb", "bto", "flat", "flats", "home", "waiting"],
  job: ["career", "employment", "work", "wage", "training", "mobility"],
  leave: ["maternity", "paternity", "parental", "shared", "return"],
  money: ["cost", "budget", "bonus", "grant", "subsidy", "wage"],
  parent: ["maternity", "paternity", "parental", "partner", "child"],
  salary: ["wage", "pay", "income"],
  stability: ["employment", "unemployment", "market", "labour"],
  support: ["benefit", "grant", "subsidy", "leave", "partner"],
  training: ["skills", "upskilling", "course", "mobility"],
  work: ["career", "employment", "job", "labour", "wage"],
}

let corpusPromise: Promise<EvidenceCorpus> | null = null

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function tokenize(value: string) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token))
}

function buildKeywordSet(parts: string[]) {
  const baseTokens = tokenize(parts.join(" "))
  const expanded = new Set<string>()

  for (const token of baseTokens) {
    expanded.add(token)
    for (const synonym of TOKEN_EXPANSIONS[token] ?? []) {
      expanded.add(synonym)
    }
  }

  return expanded
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
}

async function readJsonArray<T>(filePath: string): Promise<T[]> {
  const raw = await readFile(filePath, "utf-8")
  const parsed: unknown = JSON.parse(raw)
  return Array.isArray(parsed) ? (parsed as T[]) : []
}

function buildParentMap(trajectory: TrajectoryGraph | null | undefined) {
  const parentMap = new Map<string, string>()
  for (const link of trajectory?.links ?? []) {
    parentMap.set(link.target, link.source)
  }
  return parentMap
}

function buildChildMap(trajectory: TrajectoryGraph | null | undefined) {
  const childMap = new Map<string, string[]>()
  for (const link of trajectory?.links ?? []) {
    const existing = childMap.get(link.source) ?? []
    existing.push(link.target)
    childMap.set(link.source, existing)
  }
  return childMap
}

function buildNodeMap(trajectory: TrajectoryGraph | null | undefined) {
  return new Map((trajectory?.nodes ?? []).map((node) => [node.id, node]))
}

function buildPathNames(
  trajectory: TrajectoryGraph | null | undefined,
  selectedNode: TrajectoryNode | null | undefined
) {
  if (!trajectory || !selectedNode) {
    return [] as string[]
  }

  const nodeMap = buildNodeMap(trajectory)
  const parentMap = buildParentMap(trajectory)
  const path: string[] = []
  let currentId: string | undefined = selectedNode.id

  while (currentId) {
    const node = nodeMap.get(currentId)
    if (!node) {
      break
    }
    path.unshift(node.name)
    currentId = parentMap.get(currentId)
  }

  return path
}

function inferThemeHints(
  question: string,
  profile: UserProfile | null,
  selectedNode: TrajectoryNode | null | undefined
) {
  const combined =
    `${question} ${profile?.familyIntent ?? ""} ${selectedNode?.name ?? ""} ${
      selectedNode?.description ?? ""
    }`.toLowerCase()
  const hints = new Set<string>()

  if (
    /(family|child|baby|fertility|leave|maternity|paternity|parent|partner|childcare|pregnan|re-entry)/.test(
      combined
    )
  ) {
    for (const token of [
      "family",
      "fertility",
      "leave",
      "maternity",
      "paternity",
      "parental",
      "childcare",
    ]) {
      hints.add(token)
    }
  }

  if (/(housing|bto|hdb|flat|home|house|waiting)/.test(combined)) {
    for (const token of ["housing", "hdb", "bto", "flat", "waiting"]) {
      hints.add(token)
    }
  }

  if (
    /(budget|cost|afford|money|subsidy|grant|bonus|benefit|salary|pay|income)/.test(
      combined
    )
  ) {
    for (const token of [
      "budget",
      "cost",
      "subsidy",
      "grant",
      "bonus",
      "wage",
      "income",
    ]) {
      hints.add(token)
    }
  }

  if (
    /(career|job|work|role|promotion|manager|engineer|analyst|trajectory|market|stability|training)/.test(
      combined
    )
  ) {
    for (const token of [
      "career",
      "job",
      "employment",
      "labour",
      "market",
      "training",
      "mobility",
    ]) {
      hints.add(token)
    }
  }

  if (profile?.familyIntent === "soon" || selectedNode?.kind === "planning") {
    for (const token of ["family", "leave", "support", "childcare"]) {
      hints.add(token)
    }
  }

  return Array.from(hints)
}

function normalizeCuratedRecord(
  record: CuratedEvidenceRecord,
  sourceRegistry: Map<string, SourceRegistryEntry>
): EvidenceRecord {
  const source = sourceRegistry.get(record.sourceId)
  const excerpt = truncate(`${record.claim} ${record.summary}`, 320)
  const searchableText = normalizeWhitespace(
    [
      record.title,
      source?.publisher ?? "",
      record.theme,
      record.allowedUsage,
      record.claim,
      record.summary,
      record.relevance,
      record.pageRef,
    ].join(" ")
  )

  return {
    id: record.id,
    sourceId: record.sourceId,
    title: record.title,
    publishDate: record.publishDate,
    pageRef: record.pageRef,
    excerpt,
    sourceType: "curated",
    publisher: source?.publisher,
    searchableText,
    theme: record.theme,
    allowedUsage: record.allowedUsage,
    confidence: record.confidence,
    relevance: record.relevance,
    keywordSet: buildKeywordSet([searchableText]),
  }
}

function normalizePdfSnippetRecord(
  record: PdfSnippetRecord,
  sourceRegistry: Map<string, SourceRegistryEntry>
): EvidenceRecord {
  const source = sourceRegistry.get(record.sourceId)
  const excerpt = truncate(normalizeWhitespace(record.text), 360)
  const searchableText = normalizeWhitespace(
    [
      record.title,
      source?.publisher ?? "",
      record.sourceFile,
      record.pageRef,
      record.text,
    ].join(" ")
  )

  return {
    id: record.id,
    sourceId: record.sourceId,
    title: record.title,
    publishDate: record.publishDate,
    pageRef: record.pageRef,
    excerpt,
    sourceType: "mom_pdf",
    publisher: source?.publisher ?? "Ministry of Manpower",
    sourceFile: record.sourceFile,
    searchableText,
    keywordSet: buildKeywordSet([searchableText]),
  }
}

async function loadEvidenceCorpus() {
  if (!corpusPromise) {
    corpusPromise = (async () => {
      const sourceRegistryEntries =
        await readJsonArray<SourceRegistryEntry>(SOURCE_REGISTRY_PATH)
      const sourceRegistry = new Map(
        sourceRegistryEntries.map((entry) => [entry.sourceId, entry])
      )

      const curatedFiles = (await readdir(CURATED_DIR))
        .filter((fileName) => fileName.endsWith(".json"))
        .sort()
      const curatedBatches = await Promise.all(
        curatedFiles.map((fileName) =>
          readJsonArray<CuratedEvidenceRecord>(path.join(CURATED_DIR, fileName))
        )
      )

      let snippetRecords: PdfSnippetRecord[] = []
      try {
        snippetRecords = await readJsonArray<PdfSnippetRecord>(SNIPPETS_PATH)
      } catch {
        snippetRecords = []
      }

      const records = [
        ...curatedBatches
          .flat()
          .map((record) => normalizeCuratedRecord(record, sourceRegistry)),
        ...snippetRecords.map((record) =>
          normalizePdfSnippetRecord(record, sourceRegistry)
        ),
      ]

      return {
        records,
        sourceRegistry,
      }
    })()
  }

  return corpusPromise
}

function scoreRecord(
  record: EvidenceRecord,
  primaryTokens: string[],
  contextTokens: string[],
  themeHints: string[],
  selectedNode: TrajectoryNode | null | undefined
) {
  let score = 0

  for (const token of primaryTokens) {
    if (record.keywordSet.has(token)) {
      score += token.length >= 7 ? 2.3 : 1.5
    }
  }

  for (const token of contextTokens) {
    if (record.keywordSet.has(token)) {
      score += 0.65
    }
  }

  for (const token of themeHints) {
    if (record.keywordSet.has(token)) {
      score += 1.1
    }
  }

  if (
    selectedNode &&
    record.searchableText.includes(selectedNode.name.toLowerCase())
  ) {
    score += 5
  }

  if (
    record.theme &&
    themeHints.some((token) => record.theme?.includes(token))
  ) {
    score += 1.4
  }

  if (record.sourceType === "curated" && score > 0) {
    score += 0.45
  }

  if (
    record.sourceType === "mom_pdf" &&
    /(labour|labor|market|employment|wage|training|unemployment)/.test(
      record.title.toLowerCase()
    )
  ) {
    score += 0.2
  }

  return score
}

function selectTopEvidence(
  records: Array<{ record: EvidenceRecord; score: number }>,
  limit: number
) {
  const curated: EvidenceRecord[] = []
  const snippets: EvidenceRecord[] = []
  const curatedSources = new Set<string>()
  const snippetSources = new Set<string>()

  for (const item of records) {
    if (item.record.sourceType === "curated") {
      if (
        curated.length >= Math.min(3, limit) ||
        curatedSources.has(item.record.sourceId)
      ) {
        continue
      }
      curated.push(item.record)
      curatedSources.add(item.record.sourceId)
      continue
    }

    if (
      snippets.length >= Math.min(3, limit) ||
      snippetSources.has(item.record.sourceId)
    ) {
      continue
    }
    snippets.push(item.record)
    snippetSources.add(item.record.sourceId)
  }

  const merged = [...curated, ...snippets]
  if (merged.length >= limit) {
    return merged.slice(0, limit)
  }

  for (const item of records) {
    if (merged.some((record) => record.id === item.record.id)) {
      continue
    }
    merged.push(item.record)
    if (merged.length >= limit) {
      break
    }
  }

  return merged
}

export async function retrieveRelevantEvidence({
  messages,
  profile,
  trajectory,
  selectedNode,
  limit = 5,
}: RetrieveEvidenceInput) {
  const latestUserMessage =
    [...messages]
      .reverse()
      .find((message) => message.role === "user")
      ?.content.trim() ?? ""
  const pathNames = buildPathNames(trajectory, selectedNode)
  const childMap = buildChildMap(trajectory)
  const nodeMap = buildNodeMap(trajectory)
  const childNames = (selectedNode ? (childMap.get(selectedNode.id) ?? []) : [])
    .map((id) => nodeMap.get(id)?.name ?? "")
    .filter(Boolean)

  const primaryTokens = Array.from(
    buildKeywordSet([
      latestUserMessage,
      selectedNode?.name ?? "",
      selectedNode?.kind ?? "",
    ])
  )
  const contextTokens = Array.from(
    buildKeywordSet([
      profile?.currentJob ?? "",
      profile?.familyIntent ?? "",
      selectedNode?.description ?? "",
      pathNames.join(" "),
      childNames.join(" "),
    ])
  )
  const themeHints = inferThemeHints(latestUserMessage, profile, selectedNode)

  if (
    primaryTokens.length === 0 &&
    contextTokens.length === 0 &&
    themeHints.length === 0
  ) {
    return [] as EvidenceRecord[]
  }

  const { records } = await loadEvidenceCorpus()
  const scored = records
    .map((record) => ({
      record,
      score: scoreRecord(
        record,
        primaryTokens,
        contextTokens,
        themeHints,
        selectedNode
      ),
    }))
    .filter((item) => item.score >= 2)
    .sort((left, right) => right.score - left.score)

  return selectTopEvidence(scored, limit)
}
