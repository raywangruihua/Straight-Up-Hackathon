"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";

import Galaxy from "@/components/Galaxy";
import { CareerHistoryDialog } from "@/components/CareerHistoryDialog";
import { ProfileIntakeDialog } from "@/components/ProfileIntakeDialog";
import type {
  ProfileDraft,
  TrajectoryExpansion,
  TrajectoryGraph,
  TrajectoryNode,
  TrajectoryOption,
  UserProfile,
} from "@/lib/chat";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL;
const ForceGraph3D = dynamic(() => import("react-force-graph-3d"), { ssr: false });

const SIDEBAR_WIDTH = 380;
const NODE_CAMERA_Z = 450;
const FIT_VIEW_Y = 320;
const FIT_VIEW_Z = 1600;
const FIT_DURATION_MS = 600;
const ZOOM_DURATION_MS = 900;
const LEVEL_Y_SPACING = 170;
const NODE_X_GAP = 220;

const EMPTY_PROFILE_DRAFT: ProfileDraft = {
  age: null,
  currentJob: "",
  familyIntent: null,
};

function toProfileDraft(profile: UserProfile): ProfileDraft {
  return {
    age: profile.age,
    currentJob: profile.currentJob,
    familyIntent: profile.familyIntent,
  };
}

function toUserProfile(profile: ProfileDraft): UserProfile | null {
  if (profile.age === null || !profile.currentJob.trim() || !profile.familyIntent) {
    return null;
  }

  return {
    age: profile.age,
    currentJob: profile.currentJob.trim(),
    familyIntent: profile.familyIntent,
  };
}

let spriteMaterials: Record<string, any> | null = null;
function makeStarObject(kind: TrajectoryNode["kind"]) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const THREE = require("three");
  if (!spriteMaterials) {
    spriteMaterials = {};
  }

  const palette: Record<TrajectoryNode["kind"], [string, string, string]> = {
    history: ["rgba(254,240,138,1)", "rgba(250,204,21,0.8)", "rgba(234,179,8,0)"],
    prediction: ["rgba(191,219,254,1)", "rgba(96,165,250,0.8)", "rgba(59,130,246,0)"],
    planning: ["rgba(253,186,116,1)", "rgba(249,115,22,0.8)", "rgba(234,88,12,0)"],
    decision: ["rgba(167,243,208,1)", "rgba(16,185,129,0.8)", "rgba(5,150,105,0)"],
  };

  if (!spriteMaterials[kind]) {
    const [inner, mid, outer] = palette[kind];
    const canvas = Object.assign(document.createElement("canvas"), { width: 64, height: 64 });
    const ctx = canvas.getContext("2d")!;
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, inner);
    gradient.addColorStop(0.25, mid);
    gradient.addColorStop(1, outer);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    spriteMaterials[kind] = new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(canvas),
      depthWrite: false,
    });
  }

  const sprite = new THREE.Sprite(spriteMaterials[kind]);
  sprite.scale.set(kind === "planning" ? 42 : 48, kind === "planning" ? 42 : 48, 1);
  return sprite;
}

function configureNavigationControls(controls: any) {
  if (!controls) {
    return;
  }

  controls.enabled = true;
  controls.noRotate = true;
  controls.noPan = false;
  controls.noZoom = false;

  // Keep wheel zoom, but let middle-click drag pan the camera.
  if (controls.mouseButtons) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const THREE = require("three");
    controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
  }
}

const NODE_BUTTON_BASE =
  "w-full rounded-lg border border-border bg-popover/40 px-4 py-2.5 text-left text-sm font-medium hover:bg-accent transition-colors";

function NodeButton({
  item,
  eyebrow,
  onSelect,
  highlighted = false,
}: {
  item: TrajectoryNode;
  eyebrow: string;
  onSelect: (id: string) => void;
  highlighted?: boolean;
}) {
  return (
    <button
      onClick={() => onSelect(item.id)}
      className={`${NODE_BUTTON_BASE} ${highlighted ? "border-emerald-300/40 bg-emerald-300/10" : ""}`}
    >
      <span className="block text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        {eyebrow}
      </span>
      <span className="block truncate text-white">{item.name}</span>
    </button>
  );
}

function getLinkTargetId(link: any): string | null {
  const target = link?.target;
  if (typeof target === "string") {
    return target;
  }
  if (typeof target === "number") {
    return String(target);
  }
  if (target && typeof target === "object" && "id" in target) {
    return String(target.id);
  }
  return null;
}

export default function Page() {
  const fgRef = useRef<any>(null);
  const pendingAutoFitRef = useRef(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [activeDialog, setActiveDialog] = useState<"history" | "profile" | null>("history");
  const [trajectory, setTrajectory] = useState<TrajectoryGraph | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandingNodeIds, setExpandingNodeIds] = useState<string[]>([]);
  const [profileDraft, setProfileDraft] = useState<ProfileDraft>(EMPTY_PROFILE_DRAFT);

  const resolvedProfile = useMemo(() => toUserProfile(profileDraft), [profileDraft]);
  const nodeMap = useMemo(
    () => new Map((trajectory?.nodes ?? []).map((node) => [node.id, node])),
    [trajectory],
  );
  const parentMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const link of trajectory?.links ?? []) {
      map.set(link.target, link.source);
    }
    return map;
  }, [trajectory]);
  const childMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const link of trajectory?.links ?? []) {
      const siblings = map.get(link.source) ?? [];
      siblings.push(link.target);
      map.set(link.source, siblings);
    }
    return map;
  }, [trajectory]);

  const graphData = useMemo(() => {
    if (!trajectory) {
      return null;
    }

    return {
      nodes: trajectory.nodes.map((node) => ({
        ...node,
        fx: node.x,
        fy: node.y,
        fz: 0,
      })),
      links: trajectory.links,
    };
  }, [trajectory]);

  const selectedItem = selectedNodeId ? nodeMap.get(selectedNodeId) ?? null : null;
  const parentItem = selectedItem ? nodeMap.get(parentMap.get(selectedItem.id) ?? "") ?? null : null;
  const childItems = selectedItem
    ? (childMap.get(selectedItem.id) ?? [])
        .map((id) => nodeMap.get(id))
        .filter((item): item is TrajectoryNode => Boolean(item))
    : [];
  const isExpandingSelectedNode = selectedItem ? expandingNodeIds.includes(selectedItem.id) : false;

  async function handleHistorySubmit({
    history,
    profile,
  }: {
    history: string[];
    profile: ProfileDraft;
  }) {
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/predict-trajectory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history, profile }),
      });
      const data = (await res.json()) as TrajectoryGraph;
      pendingAutoFitRef.current = true;
      setTrajectory(data);
      setSelectedNodeId(data.focusId);
      setExpandingNodeIds([]);
      setActiveDialog(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!graphData) {
      return;
    }

    const configureControls = setInterval(() => {
      try {
        configureNavigationControls(fgRef.current?.controls?.());
      } catch {}
    }, 200);

    let initialFit: ReturnType<typeof setTimeout> | undefined;
    if (pendingAutoFitRef.current) {
      initialFit = setTimeout(() => {
        fgRef.current?.zoomToFit(FIT_DURATION_MS, 100);
        pendingAutoFitRef.current = false;
      }, 800);
    }

    return () => {
      clearInterval(configureControls);
      if (initialFit) {
        clearTimeout(initialFit);
      }
    };
  }, [graphData]);

  function zoomToNode(nodeId: string) {
    const node = nodeMap.get(nodeId);
    if (!node) {
      return;
    }

    const fov = fgRef.current?.camera()?.fov ?? 50;
    const visibleHeight = 2 * NODE_CAMERA_Z * Math.tan((fov / 2) * Math.PI / 180);
    const offsetX = -(SIDEBAR_WIDTH / 2) * (visibleHeight / window.innerHeight);
    setSelectedNodeId(nodeId);
    fgRef.current?.cameraPosition(
      { x: node.x + offsetX, y: node.y, z: NODE_CAMERA_Z },
      { x: node.x + offsetX, y: node.y, z: 0 },
      ZOOM_DURATION_MS,
    );
  }

  function getRolePath(nodeId: string, graph: TrajectoryGraph) {
    const localNodeMap = new Map(graph.nodes.map((node) => [node.id, node]));
    const localParentMap = new Map<string, string>();
    for (const link of graph.links) {
      localParentMap.set(link.target, link.source);
    }

    const path: string[] = [];
    let currentId: string | undefined = nodeId;
    while (currentId) {
      const node = localNodeMap.get(currentId);
      if (!node) {
        break;
      }
      if (node.kind !== "planning" && node.kind !== "decision") {
        path.unshift(node.name);
      }
      currentId = localParentMap.get(currentId);
    }
    return path;
  }

  function claimNearestFreeX(targetX: number, occupiedXs: number[]) {
    const roundedTarget = Math.round(targetX / NODE_X_GAP) * NODE_X_GAP;
    const attempts = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5];
    for (const attempt of attempts) {
      const candidate = roundedTarget + attempt * NODE_X_GAP;
      const isFree = occupiedXs.every((occupiedX) => Math.abs(occupiedX - candidate) >= NODE_X_GAP * 0.9);
      if (isFree) {
        occupiedXs.push(candidate);
        return candidate;
      }
    }

    const fallback = roundedTarget + attempts.length * NODE_X_GAP;
    occupiedXs.push(fallback);
    return fallback;
  }

  function mergeExpansionOptions(
    graph: TrajectoryGraph,
    parentId: string,
    options: TrajectoryOption[],
  ): TrajectoryGraph {
    if (options.length === 0) {
      return graph;
    }

    const parentNode = graph.nodes.find((node) => node.id === parentId);
    if (!parentNode) {
      return graph;
    }

    const targetLevel = parentNode.level + 1;
    const occupiedXs = graph.nodes
      .filter((node) => node.level === targetLevel)
      .map((node) => node.x);
    const centeredOffsets = options.map(
      (_, index) => parentNode.x + (index - (options.length - 1) / 2) * NODE_X_GAP,
    );

    const newNodes = options.map((option, index) => ({
      id: `prediction-${parentId}-${index}-${option.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      name: option.name,
      description: option.description,
      kind: option.kind,
      level: targetLevel,
      x: claimNearestFreeX(centeredOffsets[index], occupiedXs),
      y: targetLevel * LEVEL_Y_SPACING,
    })) satisfies TrajectoryNode[];

    const newLinks = newNodes.map((node) => ({ source: parentId, target: node.id }));

    return {
      ...graph,
      nodes: [...graph.nodes, ...newNodes],
      links: [...graph.links, ...newLinks],
    };
  }

  function mergeDecisionNodes(graph: TrajectoryGraph, parentId: string): TrajectoryGraph {
    const parentNode = graph.nodes.find((node) => node.id === parentId);
    if (!parentNode) {
      return graph;
    }

    const existingChildren = graph.links.filter((link) => link.source === parentId);
    if (existingChildren.length > 0) {
      return graph;
    }

    const decisionNodes: TrajectoryNode[] = [
      {
        id: `decision-career-${parentId}`,
        name: "Progress Career",
        description: "Explore role moves and adjacent career directions from this point.",
        kind: "decision",
        decisionType: "career",
        level: parentNode.level + 1,
        x: parentNode.x - NODE_X_GAP / 1.5,
        y: (parentNode.level + 1) * LEVEL_Y_SPACING,
      },
    ];

    if (resolvedProfile?.familyIntent) {
      decisionNodes.push({
        id: `decision-family-${parentId}`,
        name: "Progress Family Planning",
        description: "Explore family-planning and re-entry scenarios as explicit branches.",
        kind: "decision",
        decisionType: "family",
        level: parentNode.level + 1,
        x: parentNode.x + NODE_X_GAP / 1.5,
        y: (parentNode.level + 1) * LEVEL_Y_SPACING,
      });
    }

    return {
      ...graph,
      nodes: [...graph.nodes, ...decisionNodes],
      links: [
        ...graph.links,
        ...decisionNodes.map((node) => ({ source: parentId, target: node.id })),
      ],
    };
  }

  async function ensureNodeExpanded(nodeId: string) {
    if (!trajectory) {
      return;
    }

    const node = nodeMap.get(nodeId);
    if (!node || node.kind === "planning" || childMap.has(nodeId) || expandingNodeIds.includes(nodeId)) {
      return;
    }

    if (node.kind !== "decision") {
      setTrajectory((current) => (current ? mergeDecisionNodes(current, nodeId) : current));
      return;
    }

    const path = getRolePath(nodeId, trajectory);
    setExpandingNodeIds((current) => [...current, nodeId]);

    try {
      const res = await fetch(`${BACKEND_URL}/expand-options`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, profile: profileDraft, decisionType: node.decisionType }),
      });
      const data = (await res.json()) as TrajectoryExpansion;
      setTrajectory((current) => {
        if (!current) {
          return current;
        }
        if (current.links.some((link) => link.source === nodeId)) {
          return current;
        }
        return mergeExpansionOptions(current, nodeId, data.options);
      });
    } finally {
      setExpandingNodeIds((current) => current.filter((id) => id !== nodeId));
    }
  }

  function handleBackReset() {
    setSelectedNodeId(null);
    const fg = fgRef.current;
    if (!fg) {
      return;
    }
    fg.cameraPosition({ x: 0, y: FIT_VIEW_Y, z: FIT_VIEW_Z }, { x: 0, y: FIT_VIEW_Y, z: 0 }, 0);
    setTimeout(() => fg.zoomToFit(FIT_DURATION_MS, 100), 50);
  }

  return (
    <div
      className="dark"
      style={{ position: "relative", width: "100vw", height: "100vh", background: "#0a0a0a" }}
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
          setProfileDraft(toProfileDraft(profile));
          setActiveDialog("history");
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
              nodeThreeObject={(node: any) => makeStarObject((node as TrajectoryNode).kind)}
              nodeThreeObjectExtend={false}
              linkColor={(link: any) => {
                const targetId = getLinkTargetId(link) ?? "";
                const targetNode = nodeMap.get(targetId);
                if (targetNode?.kind === "decision") {
                  return "#34d399";
                }
                if (targetNode?.kind === "planning") {
                  return "#fb923c";
                }
                return "#60a5fa";
              }}
              linkWidth={1.7}
              linkDirectionalArrowLength={6}
              linkDirectionalArrowRelPos={1}
              onNodeClick={(node: any) => {
                const nodeId = String((node as TrajectoryNode).id);
                zoomToNode(nodeId);
                void ensureNodeExpanded(nodeId);
              }}
              onBackgroundClick={handleBackReset}
            />
          </div>
        </>
      )}
      {resolvedProfile && (
        <div className="absolute right-6 top-6 z-10 max-w-sm rounded-xl border border-emerald-300/25 bg-emerald-300/10 px-4 py-3 text-sm text-emerald-50 backdrop-blur-md">
          <p className="font-medium">Profile captured</p>
          <p className="mt-1 text-emerald-100/85">
            Age {resolvedProfile.age}, {resolvedProfile.currentJob}, family intent:{" "}
            {resolvedProfile.familyIntent}
          </p>
        </div>
      )}
      {selectedItem && (
        <aside className="absolute left-0 top-0 z-10 flex h-full w-[380px] flex-col gap-6 border-r border-white/10 bg-gradient-to-b from-slate-950/90 via-slate-900/80 to-slate-950/90 px-7 py-8 backdrop-blur-xl">
          <button
            onClick={handleBackReset}
            className="self-start rounded-lg border border-border bg-popover/40 px-3.5 py-2 text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground hover:bg-accent transition-colors"
          >
            Reset view
          </button>
          <div className="space-y-1.5 text-center">
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
              {selectedItem.kind === "planning"
                ? "Planning branch"
                : selectedItem.kind === "decision"
                  ? "Decision node"
                  : "Career node"}
            </p>
            <h2 className="text-xl font-semibold leading-tight text-primary">{selectedItem.name}</h2>
          </div>
          {parentItem && (
            <div className="space-y-2 rounded-xl border border-emerald-300/20 bg-emerald-300/10 px-4 py-4">
              <p className="text-[10px] uppercase tracking-[0.2em] text-emerald-100/80">
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
          {childItems.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
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
                />
              ))}
            </div>
          )}
          {selectedItem && selectedItem.kind !== "planning" && childItems.length === 0 && (
            <div className="space-y-3 rounded-lg border border-white/10 bg-white/5 px-4 py-4">
              <p className="text-sm text-slate-300">
                {isExpandingSelectedNode
                  ? "Exploring next moves from this node..."
                  : selectedItem.kind === "decision"
                    ? "Reveal the concrete branches behind this decision."
                    : "Reveal the next explicit decisions from this point."}
              </p>
              {!isExpandingSelectedNode && (
                <button
                  onClick={() => void ensureNodeExpanded(selectedItem.id)}
                  className="w-full rounded-lg border border-border bg-popover/40 px-4 py-2.5 text-sm font-medium hover:bg-accent transition-colors"
                >
                  {selectedItem.kind === "decision" ? "Reveal branches from this decision" : "Reveal next decisions"}
                </button>
              )}
            </div>
          )}
          {selectedItem.description && (
            <div className="flex-1 min-h-0 overflow-y-auto border-t border-white/10 pt-5">
              <p className="text-sm leading-relaxed text-foreground/85">{selectedItem.description}</p>
            </div>
          )}
        </aside>
      )}
    </div>
  );
}
