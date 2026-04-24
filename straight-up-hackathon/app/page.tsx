"use client"

import dynamic from "next/dynamic"
import { useEffect, useMemo, useRef, useState } from "react"
import type {
  ForceGraphMethods,
  LinkObject,
  NodeObject,
} from "react-force-graph-3d"

import AdvisorChatPanel from "@/components/AdvisorChatPanel"
import Galaxy from "@/components/Galaxy"
import { CareerHistoryDialog } from "@/components/CareerHistoryDialog"
import { ProfileIntakeDialog } from "@/components/ProfileIntakeDialog"
import type {
  ProfileDraft,
  TrajectoryExpansion,
  TrajectoryGraph,
  TrajectoryNode,
  TrajectoryOption,
  UserProfile,
} from "@/lib/chat"

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL
const ForceGraph3D = dynamic(() => import("react-force-graph-3d"), {
  ssr: false,
})

const NODE_DETAILS_PANEL_WIDTH = 380
const ADVISOR_PANEL_WIDTH = 420
const PANEL_OFFSET_BREAKPOINT = 1280
const NODE_CAMERA_Z = 450
const FIT_VIEW_Y = 320
const FIT_VIEW_Z = 1600
const FIT_DURATION_MS = 600
const ZOOM_DURATION_MS = 900
const LEVEL_Y_SPACING = 170
const NODE_X_GAP = 220

const EMPTY_PROFILE_DRAFT: ProfileDraft = {
  age: null,
  currentJob: "",
  familyIntent: null,
}

function toProfileDraft(profile: UserProfile): ProfileDraft {
  return {
    age: profile.age,
    currentJob: profile.currentJob,
    familyIntent: profile.familyIntent,
  }
}

function toUserProfile(profile: ProfileDraft): UserProfile | null {
  if (
    profile.age === null ||
    !profile.currentJob.trim() ||
    !profile.familyIntent
  ) {
    return null
  }

  return {
    age: profile.age,
    currentJob: profile.currentJob.trim(),
    familyIntent: profile.familyIntent,
  }
}

type LegacyTrajectoryItem = {
  name?: string
  description?: string
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
}

function normalizeTrajectoryResponse(value: unknown): TrajectoryGraph {
  if (
    value &&
    typeof value === "object" &&
    "nodes" in value &&
    "links" in value
  ) {
    const graph = value as Partial<TrajectoryGraph>
    return {
      nodes: Array.isArray(graph.nodes) ? graph.nodes : [],
      links: Array.isArray(graph.links) ? graph.links : [],
      rootId: typeof graph.rootId === "string" ? graph.rootId : null,
      focusId: typeof graph.focusId === "string" ? graph.focusId : null,
    }
  }

  if (!Array.isArray(value)) {
    return {
      nodes: [],
      links: [],
      rootId: null,
      focusId: null,
    }
  }

  const items = value as LegacyTrajectoryItem[]
  const nodes: TrajectoryNode[] = items.map((item, index) => {
    const name =
      typeof item?.name === "string" && item.name.trim()
        ? item.name.trim()
        : `Step ${index + 1}`
    const description =
      typeof item?.description === "string" ? item.description : ""
    const kind: TrajectoryNode["kind"] =
      index === 0
        ? "history"
        : /family|planning|runway|checkpoint|acceleration/i.test(name)
          ? "planning"
          : "prediction"

    return {
      id: `${kind}-${index}-${slugify(name) || "step"}`,
      name,
      description,
      kind,
      level: index,
      x: 0,
      y: index * LEVEL_Y_SPACING,
    }
  })

  const links = nodes.slice(1).map((node, index) => ({
    source: nodes[index].id,
    target: node.id,
  }))

  return {
    nodes,
    links,
    rootId: nodes[0]?.id ?? null,
    focusId: nodes[nodes.length - 1]?.id ?? nodes[0]?.id ?? null,
  }
}

type GraphLinkLike = {
  target?: unknown
}

type GraphNodeLike = {
  id?: string | number
  kind?: TrajectoryNode["kind"]
}

type NavigationControlsLike = {
  enabled: boolean
  noRotate: boolean
  noPan: boolean
  noZoom: boolean
  mouseButtons?: { MIDDLE?: number }
}

type ForceGraphHandle = ForceGraphMethods<
  NodeObject<GraphNodeLike>,
  LinkObject<GraphNodeLike, GraphLinkLike>
>

let spriteMaterials: Record<string, unknown> | null = null
function makeStarObject(kind: TrajectoryNode["kind"]) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const THREE = require("three")
  if (!spriteMaterials) {
    spriteMaterials = {}
  }

  const palette: Record<TrajectoryNode["kind"], [string, string, string]> = {
    history: [
      "rgba(254,240,138,1)",
      "rgba(250,204,21,0.8)",
      "rgba(234,179,8,0)",
    ],
    prediction: [
      "rgba(191,219,254,1)",
      "rgba(96,165,250,0.8)",
      "rgba(59,130,246,0)",
    ],
    planning: [
      "rgba(253,186,116,1)",
      "rgba(249,115,22,0.8)",
      "rgba(234,88,12,0)",
    ],
    decision: [
      "rgba(167,243,208,1)",
      "rgba(16,185,129,0.8)",
      "rgba(5,150,105,0)",
    ],
  }

  if (!spriteMaterials[kind]) {
    const [inner, mid, outer] = palette[kind]
    const canvas = Object.assign(document.createElement("canvas"), {
      width: 64,
      height: 64,
    })
    const ctx = canvas.getContext("2d")!
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
    gradient.addColorStop(0, inner)
    gradient.addColorStop(0.25, mid)
    gradient.addColorStop(1, outer)
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 64, 64)
    spriteMaterials[kind] = new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(canvas),
      depthWrite: false,
    })
  }

  const sprite = new THREE.Sprite(spriteMaterials[kind])
  sprite.scale.set(
    kind === "planning" ? 42 : 48,
    kind === "planning" ? 42 : 48,
    1
  )
  return sprite
}

function configureNavigationControls(
  controls: NavigationControlsLike | null | undefined
) {
  if (!controls) {
    return
  }

  controls.enabled = true
  controls.noRotate = true
  controls.noPan = false
  controls.noZoom = false

  // Keep wheel zoom, but let middle-click drag pan the camera.
  if (controls.mouseButtons) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const THREE = require("three")
    controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN
  }
}

const EYEBROW_CLASS =
  "text-[11px] font-medium tracking-[0.22em] text-sky-200/70 uppercase"
const NODE_BUTTON_BASE =
  "w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-left text-sm font-medium hover:bg-white/10 transition-colors"

function NodeButton({
  item,
  eyebrow,
  onSelect,
  highlighted = false,
}: {
  item: TrajectoryNode
  eyebrow: string
  onSelect: (id: string) => void
  highlighted?: boolean
}) {
  return (
    <button
      onClick={() => onSelect(item.id)}
      className={`${NODE_BUTTON_BASE} ${highlighted ? "border-sky-300/25 bg-sky-300/10 hover:bg-sky-300/15" : ""}`}
    >
      <span
        className={`block text-[11px] font-medium tracking-[0.22em] uppercase ${highlighted ? "text-sky-100/75" : "text-sky-200/70"}`}
      >
        {eyebrow}
      </span>
      <span className="block truncate text-white">{item.name}</span>
    </button>
  )
}

function getLinkTargetId(link: GraphLinkLike): string | null {
  const target = link?.target
  if (typeof target === "string") {
    return target
  }
  if (typeof target === "number") {
    return String(target)
  }
  if (target && typeof target === "object" && "id" in target) {
    return String(target.id)
  }
  return null
}

function getViewportPanelWidths(hasLeftPanel: boolean, hasRightPanel: boolean) {
  if (
    typeof window === "undefined" ||
    window.innerWidth < PANEL_OFFSET_BREAKPOINT
  ) {
    return {
      left: 0,
      right: 0,
    }
  }

  return {
    left: hasLeftPanel ? NODE_DETAILS_PANEL_WIDTH : 0,
    right: hasRightPanel ? ADVISOR_PANEL_WIDTH : 0,
  }
}

function getCameraOffsetX(
  cameraZ: number,
  fov: number,
  hasLeftPanel: boolean,
  hasRightPanel: boolean
) {
  if (typeof window === "undefined") {
    return 0
  }

  const { left, right } = getViewportPanelWidths(hasLeftPanel, hasRightPanel)
  const visibleHeight = 2 * cameraZ * Math.tan(((fov / 2) * Math.PI) / 180)
  return -((left - right) / 2) * (visibleHeight / window.innerHeight)
}

export default function Page() {
  const fgRef = useRef<ForceGraphHandle | undefined>(undefined)
  const pendingAutoFitRef = useRef(false)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [activeDialog, setActiveDialog] = useState<
    "history" | "profile" | null
  >("history")
  const [trajectory, setTrajectory] = useState<TrajectoryGraph | null>(null)
  const [loading, setLoading] = useState(false)
  const [expandingNodeIds, setExpandingNodeIds] = useState<string[]>([])
  const [profileDraft, setProfileDraft] =
    useState<ProfileDraft>(EMPTY_PROFILE_DRAFT)

  const resolvedProfile = useMemo(
    () => toUserProfile(profileDraft),
    [profileDraft]
  )
  const nodeMap = useMemo(
    () => new Map((trajectory?.nodes ?? []).map((node) => [node.id, node])),
    [trajectory]
  )
  const parentMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const link of trajectory?.links ?? []) {
      map.set(link.target, link.source)
    }
    return map
  }, [trajectory])
  const childMap = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const link of trajectory?.links ?? []) {
      const siblings = map.get(link.source) ?? []
      siblings.push(link.target)
      map.set(link.source, siblings)
    }
    return map
  }, [trajectory])

  const graphData = useMemo(() => {
    if (!trajectory?.nodes || !trajectory?.links) {
      return null
    }

    return {
      nodes: trajectory.nodes.map((node) => ({
        ...node,
        fx: node.x,
        fy: node.y,
        fz: 0,
      })),
      links: trajectory.links,
    }
  }, [trajectory])

  const selectedItem = selectedNodeId
    ? (nodeMap.get(selectedNodeId) ?? null)
    : null
  const parentItem = selectedItem
    ? (nodeMap.get(parentMap.get(selectedItem.id) ?? "") ?? null)
    : null
  const childItems = selectedItem
    ? (childMap.get(selectedItem.id) ?? [])
        .map((id) => nodeMap.get(id))
        .filter((item): item is TrajectoryNode => Boolean(item))
    : []
  const isExpandingSelectedNode = selectedItem
    ? expandingNodeIds.includes(selectedItem.id)
    : false

  async function handleHistorySubmit({
    history,
    profile,
  }: {
    history: string[]
    profile: ProfileDraft
  }) {
    setLoading(true)
    try {
      const res = await fetch(`${BACKEND_URL}/predict-trajectory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history, profile }),
      })
      if (!res.ok) {
        throw new Error(`predict-trajectory failed with status ${res.status}`)
      }
      const rawData = await res.json()
      const data = normalizeTrajectoryResponse(rawData)
      pendingAutoFitRef.current = true
      setTrajectory(data)
      setSelectedNodeId(data.focusId)
      setExpandingNodeIds([])
      setActiveDialog(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!graphData) {
      return
    }

    const configureControls = setInterval(() => {
      try {
        configureNavigationControls(
          fgRef.current?.controls?.() as NavigationControlsLike | undefined
        )
      } catch {}
    }, 200)

    let initialFit: ReturnType<typeof setTimeout> | undefined
    if (pendingAutoFitRef.current) {
      initialFit = setTimeout(() => {
        fgRef.current?.zoomToFit(FIT_DURATION_MS, 160)
        pendingAutoFitRef.current = false
      }, 800)
    }

    return () => {
      clearInterval(configureControls)
      if (initialFit) {
        clearTimeout(initialFit)
      }
    }
  }, [graphData])

  function zoomToNode(nodeId: string) {
    const node = nodeMap.get(nodeId)
    if (!node) {
      return
    }

    const fov =
      (fgRef.current?.camera() as { fov?: number } | undefined)?.fov ?? 50
    const offsetX = getCameraOffsetX(
      NODE_CAMERA_Z,
      fov,
      true,
      Boolean(trajectory)
    )
    setSelectedNodeId(nodeId)
    fgRef.current?.cameraPosition(
      { x: node.x + offsetX, y: node.y, z: NODE_CAMERA_Z },
      { x: node.x + offsetX, y: node.y, z: 0 },
      ZOOM_DURATION_MS
    )
  }

  function getRolePath(nodeId: string, graph: TrajectoryGraph) {
    const localNodeMap = new Map(graph.nodes.map((node) => [node.id, node]))
    const localParentMap = new Map<string, string>()
    for (const link of graph.links) {
      localParentMap.set(link.target, link.source)
    }

    const path: string[] = []
    let currentId: string | undefined = nodeId
    while (currentId) {
      const node = localNodeMap.get(currentId)
      if (!node) {
        break
      }
      if (node.kind !== "planning" && node.kind !== "decision") {
        path.unshift(node.name)
      }
      currentId = localParentMap.get(currentId)
    }
    return path
  }

  function claimNearestFreeX(targetX: number, occupiedXs: number[]) {
    const roundedTarget = Math.round(targetX / NODE_X_GAP) * NODE_X_GAP
    const attempts = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5]
    for (const attempt of attempts) {
      const candidate = roundedTarget + attempt * NODE_X_GAP
      const isFree = occupiedXs.every(
        (occupiedX) => Math.abs(occupiedX - candidate) >= NODE_X_GAP * 0.9
      )
      if (isFree) {
        occupiedXs.push(candidate)
        return candidate
      }
    }

    const fallback = roundedTarget + attempts.length * NODE_X_GAP
    occupiedXs.push(fallback)
    return fallback
  }

  function mergeExpansionOptions(
    graph: TrajectoryGraph,
    parentId: string,
    options: TrajectoryOption[]
  ): TrajectoryGraph {
    if (options.length === 0) {
      return graph
    }

    const parentNode = graph.nodes.find((node) => node.id === parentId)
    if (!parentNode) {
      return graph
    }

    const targetLevel = parentNode.level + 1
    const occupiedXs = graph.nodes
      .filter((node) => node.level === targetLevel)
      .map((node) => node.x)
    const centeredOffsets = options.map(
      (_, index) =>
        parentNode.x + (index - (options.length - 1) / 2) * NODE_X_GAP
    )

    const newNodes = options.map((option, index) => ({
      id: `prediction-${parentId}-${index}-${option.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      name: option.name,
      description: option.description,
      kind: option.kind,
      level: targetLevel,
      x: claimNearestFreeX(centeredOffsets[index], occupiedXs),
      y: targetLevel * LEVEL_Y_SPACING,
    })) satisfies TrajectoryNode[]

    const newLinks = newNodes.map((node) => ({
      source: parentId,
      target: node.id,
    }))

    return {
      ...graph,
      nodes: [...graph.nodes, ...newNodes],
      links: [...graph.links, ...newLinks],
    }
  }

  function mergeDecisionNodes(
    graph: TrajectoryGraph,
    parentId: string
  ): TrajectoryGraph {
    const parentNode = graph.nodes.find((node) => node.id === parentId)
    if (!parentNode) {
      return graph
    }

    const existingChildren = graph.links.filter(
      (link) => link.source === parentId
    )
    if (existingChildren.length > 0) {
      return graph
    }

    const decisionNodes: TrajectoryNode[] = [
      {
        id: `decision-career-${parentId}`,
        name: "Progress Career",
        description:
          "Explore role moves and adjacent career directions from this point.",
        kind: "decision",
        decisionType: "career",
        level: parentNode.level + 1,
        x: parentNode.x - NODE_X_GAP / 1.5,
        y: (parentNode.level + 1) * LEVEL_Y_SPACING,
      },
    ]

    if (resolvedProfile?.familyIntent) {
      decisionNodes.push({
        id: `decision-family-${parentId}`,
        name: "Progress Family Planning",
        description:
          "Explore family-planning and re-entry scenarios as explicit branches.",
        kind: "decision",
        decisionType: "family",
        level: parentNode.level + 1,
        x: parentNode.x + NODE_X_GAP / 1.5,
        y: (parentNode.level + 1) * LEVEL_Y_SPACING,
      })
    }

    return {
      ...graph,
      nodes: [...graph.nodes, ...decisionNodes],
      links: [
        ...graph.links,
        ...decisionNodes.map((node) => ({ source: parentId, target: node.id })),
      ],
    }
  }

  async function ensureNodeExpanded(nodeId: string) {
    if (!trajectory) {
      return
    }

    const node = nodeMap.get(nodeId)
    if (
      !node ||
      node.kind === "planning" ||
      childMap.has(nodeId) ||
      expandingNodeIds.includes(nodeId)
    ) {
      return
    }

    if (node.kind !== "decision") {
      setTrajectory((current) =>
        current ? mergeDecisionNodes(current, nodeId) : current
      )
      return
    }

    const path = getRolePath(nodeId, trajectory)
    setExpandingNodeIds((current) => [...current, nodeId])

    try {
      const res = await fetch(`${BACKEND_URL}/expand-options`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path,
          profile: profileDraft,
          decisionType: node.decisionType,
        }),
      })
      const data = (await res.json()) as TrajectoryExpansion
      setTrajectory((current) => {
        if (!current) {
          return current
        }
        if (current.links.some((link) => link.source === nodeId)) {
          return current
        }
        return mergeExpansionOptions(current, nodeId, data.options)
      })
    } finally {
      setExpandingNodeIds((current) => current.filter((id) => id !== nodeId))
    }
  }

  function handleBackReset() {
    setSelectedNodeId(null)
    const fg = fgRef.current
    if (!fg) {
      return
    }
    const fov = (fg.camera() as { fov?: number } | undefined)?.fov ?? 50
    const offsetX = getCameraOffsetX(
      FIT_VIEW_Z,
      fov,
      false,
      Boolean(trajectory)
    )
    fg.cameraPosition(
      { x: offsetX, y: FIT_VIEW_Y, z: FIT_VIEW_Z },
      { x: offsetX, y: FIT_VIEW_Y, z: 0 },
      0
    )
    setTimeout(() => fg.zoomToFit(FIT_DURATION_MS, 160), 50)
  }

  return (
    <div
      className="dark"
      style={{
        position: "relative",
        width: "100vw",
        height: "100vh",
        background: "#0a0a0a",
      }}
    >
      <CareerHistoryDialog
        open={activeDialog === "history"}
        loading={loading}
        profileDraft={profileDraft}
        profileCaptured={Boolean(resolvedProfile)}
        onProfileDraftChange={setProfileDraft}
        onSubmit={handleHistorySubmit}
        onStartGuidedChat={() => setActiveDialog("profile")}
      />
      <ProfileIntakeDialog
        open={activeDialog === "profile"}
        onBack={() => setActiveDialog("history")}
        onProfileCaptured={(profile) => {
          setProfileDraft(toProfileDraft(profile))
          setActiveDialog("history")
        }}
      />
      {graphData && (
        <>
          <div className="absolute inset-0">
            <Galaxy
              mouseRepulsion={false}
              mouseInteraction
              density={2}
              glowIntensity={0.2}
              saturation={0}
              hueShift={140}
              twinkleIntensity={1}
              rotationSpeed={0}
              repulsionStrength={2}
              autoCenterRepulsion={0}
              starSpeed={0}
              speed={0}
            />
          </div>
          <div className="absolute inset-0">
            <ForceGraph3D
              ref={fgRef}
              graphData={graphData}
              nodeLabel=""
              backgroundColor="rgba(0,0,0,0)"
              numDimensions={2}
              nodeThreeObject={(node: GraphNodeLike) =>
                makeStarObject(node.kind ?? "prediction")
              }
              nodeThreeObjectExtend={false}
              linkColor={(link: GraphLinkLike) => {
                const targetId = getLinkTargetId(link) ?? ""
                const targetNode = nodeMap.get(targetId)
                if (targetNode?.kind === "decision") {
                  return "#34d399"
                }
                if (targetNode?.kind === "planning") {
                  return "#fb923c"
                }
                return "#60a5fa"
              }}
              linkWidth={1.7}
              linkDirectionalArrowLength={6}
              linkDirectionalArrowRelPos={1}
              onNodeClick={(node: GraphNodeLike) => {
                if (node.id === undefined || node.id === null) {
                  return
                }

                const nodeId = String(node.id)
                zoomToNode(nodeId)
                void ensureNodeExpanded(nodeId)
              }}
              onBackgroundClick={handleBackReset}
            />
          </div>
        </>
      )}
      {trajectory ? (
        <AdvisorChatPanel
          profile={resolvedProfile}
          trajectory={trajectory}
          selectedNode={selectedItem}
        />
      ) : null}
      {selectedItem && (
        <aside className="absolute top-0 left-0 z-10 flex h-full w-[380px] flex-col gap-6 border-r border-white/10 bg-gradient-to-b from-slate-950/90 via-slate-900/80 to-slate-950/90 px-7 py-8 backdrop-blur-xl">
          <button
            onClick={handleBackReset}
            className="h-9 self-start rounded-xl border border-white/15 bg-white/5 px-3.5 text-[11px] font-medium tracking-[0.22em] text-slate-200 uppercase transition-colors hover:bg-white/10"
          >
            Reset view
          </button>
          <div className="space-y-1.5 text-center">
            <p className={EYEBROW_CLASS}>
              {selectedItem.kind === "planning"
                ? "Planning branch"
                : selectedItem.kind === "decision"
                  ? "Decision node"
                  : "Career node"}
            </p>
            <h2 className="text-xl leading-tight font-semibold text-white">
              {selectedItem.name}
            </h2>
          </div>
          {childItems.length > 0 && (
            <div className="space-y-2 rounded-xl border border-sky-300/25 bg-sky-300/10 px-4 py-4">
              <p className="text-[11px] font-medium tracking-[0.22em] text-sky-100/75 uppercase">
                Options from here
              </p>
              {childItems.map((item) => (
                <NodeButton
                  key={item.id}
                  item={item}
                  eyebrow={
                    item.kind === "decision"
                      ? "Explore path"
                      : item.kind === "planning"
                        ? "Planning scenario"
                        : "Role option"
                  }
                  onSelect={zoomToNode}
                  highlighted
                />
              ))}
            </div>
          )}
          {selectedItem &&
            selectedItem.kind !== "planning" &&
            childItems.length === 0 && (
              <div className="space-y-2 rounded-xl border border-sky-300/25 bg-sky-300/10 px-4 py-4">
                <p className="text-[11px] font-medium tracking-[0.22em] text-sky-100/75 uppercase">
                  Next step
                </p>
                <button
                  onClick={() => void ensureNodeExpanded(selectedItem.id)}
                  disabled={isExpandingSelectedNode}
                  className={`${NODE_BUTTON_BASE} border-sky-300/25 bg-sky-300/10 hover:bg-sky-300/15 disabled:cursor-not-allowed disabled:opacity-70`}
                >
                  <span className="block text-[11px] font-medium tracking-[0.22em] text-sky-100/75 uppercase">
                    {isExpandingSelectedNode ? "Loading" : "Reveal"}
                  </span>
                  <span className="block text-white">
                    {isExpandingSelectedNode
                      ? "Exploring next moves from this node..."
                      : selectedItem.kind === "decision"
                        ? "Reveal branches from this decision"
                        : "Reveal next decisions"}
                  </span>
                </button>
              </div>
            )}
          {parentItem && (
            <div className="space-y-2 rounded-xl border border-sky-300/25 bg-sky-300/10 px-4 py-4">
              <p className="text-[11px] font-medium tracking-[0.22em] text-sky-100/75 uppercase">
                Previous step
              </p>
              <NodeButton
                item={parentItem}
                eyebrow="Go back"
                onSelect={zoomToNode}
                highlighted
              />
            </div>
          )}
          {selectedItem.description && (
            <div className="min-h-0 flex-1 overflow-y-auto border-t border-white/10 pt-5">
              <p className="text-sm leading-relaxed text-slate-300">
                {selectedItem.description}
              </p>
            </div>
          )}
        </aside>
      )}
    </div>
  )
}
