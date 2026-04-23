"use client";

import dynamic from "next/dynamic";
import Galaxy from "@/components/Galaxy";
import { CareerHistoryDialog } from "@/components/CareerHistoryDialog";
import { ProfileIntakeDialog } from "@/components/ProfileIntakeDialog";
import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import type { UserProfile } from "@/lib/chat";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL;

const ForceGraph3D = dynamic(() => import("react-force-graph-3d"), { ssr: false });

const NODE_SPACING = 120;
const SIDEBAR_WIDTH = 360;
const NODE_CAMERA_Z = 350;

type TrajectoryItem = { name: string; description: string };
type GraphNode = { id: string; fx: number; fy: number };
type GraphLink = { source: string; target: string };
type GraphData = { nodes: GraphNode[]; links: GraphLink[] };

function trajectoryToGraphData(trajectory: TrajectoryItem[]): GraphData {
  const nodes: GraphNode[] = trajectory.map((item, i) => ({
    id: item.name,
    fx: 0,
    fy: i * NODE_SPACING,
  }));
  const links: GraphLink[] = trajectory.slice(0, -1).map((item, i) => ({
    source: item.name,
    target: trajectory[i + 1].name,
  }));
  return { nodes, links };
}

let cachedMaterial: any = null;
function makeStarObject() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const THREE = require("three");
  if (!cachedMaterial) {
    const canvas = Object.assign(document.createElement("canvas"), { width: 64, height: 64 });
    const ctx = canvas.getContext("2d")!;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0,    "rgba(232,210,255,1)");
    g.addColorStop(0.25, "rgba(167,139,250,0.8)");
    g.addColorStop(0.55, "rgba(99,102,241,0.3)");
    g.addColorStop(1,    "rgba(99,102,241,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    cachedMaterial = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthWrite: false });
  }
  const sprite = new THREE.Sprite(cachedMaterial);
  sprite.scale.set(48, 48, 1);
  return sprite;
}

export default function Page() {
  const fgRef = useRef<any>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [showBack, setShowBack] = useState(false);
  const [activeDialog, setActiveDialog] = useState<"history" | "profile" | null>("history");
  const [trajectory, setTrajectory] = useState<TrajectoryItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);

  const graphData = useMemo(
    () => (trajectory ? trajectoryToGraphData(trajectory) : null),
    [trajectory],
  );

  async function handleHistorySubmit(history: string[]) {
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/predict-trajectory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history }),
      });
      const result: TrajectoryItem[] = await res.json();
      setTrajectory(result);
      setActiveDialog(null);
    } finally {
      setLoading(false);
    }
  }

  // Lock controls and zoomToFit once the graph mounts (graphData becomes available)
  useEffect(() => {
    if (!graphData) return;
    const lockControls = setInterval(() => {
      try { fgRef.current?.controls?.().enabled === true && (fgRef.current.controls().enabled = false); } catch {}
    }, 200);
    const initialFit = setTimeout(() => fgRef.current?.zoomToFit(600, 20), 800);
    return () => { clearInterval(lockControls); clearTimeout(initialFit); };
  }, [graphData]);

  const zoomToNode = useCallback((id: string) => {
    const index = trajectory?.findIndex((item) => item.name === id) ?? -1;
    if (index < 0) return;
    const fov = fgRef.current?.camera()?.fov ?? 50;
    const visibleHeight = 2 * NODE_CAMERA_Z * Math.tan((fov / 2) * Math.PI / 180);
    const worldPerPixel = visibleHeight / window.innerHeight;
    const offsetX = -(SIDEBAR_WIDTH / 2) * worldPerPixel;
    const y = index * NODE_SPACING;
    setSelectedNode(id);
    setShowBack(true);
    fgRef.current?.cameraPosition(
      { x: offsetX, y, z: NODE_CAMERA_Z },
      { x: offsetX, y, z: 0 },
      900,
    );
  }, [trajectory]);

  const handleBackReset = useCallback(() => {
    setSelectedNode(null);
    setShowBack(false);
    const fg = fgRef.current;
    if (!fg) return;
    fg.cameraPosition({ x: 0, y: 360, z: 1500 }, { x: 0, y: 360, z: 0 }, 0);
    setTimeout(() => fg.zoomToFit(600, 20), 50);
  }, []);

  const selectedItem = trajectory?.find((item) => item.name === selectedNode);
  const selectedIndex = trajectory?.findIndex((item) => item.name === selectedNode) ?? -1;
  const nextItem = selectedIndex >= 0 ? trajectory?.[selectedIndex + 1] : undefined;
  const prevItem = selectedIndex > 0 ? trajectory?.[selectedIndex - 1] : undefined;

  return (
    <div className="dark" style={{ position: "relative", width: "100vw", height: "100vh", background: "#0a0a0a" }}>
      <CareerHistoryDialog
        open={activeDialog === "history"}
        loading={loading}
        profileCaptured={Boolean(profile)}
        onSubmit={handleHistorySubmit}
        onStartGuidedChat={() => setActiveDialog("profile")}
      />
      <ProfileIntakeDialog
        open={activeDialog === "profile"}
        onBack={() => setActiveDialog("history")}
        onProfileCaptured={(capturedProfile) => {
          setProfile(capturedProfile);
          setActiveDialog("history");
        }}
      />
      {graphData && (
        <>
          <div style={{ position: "absolute", inset: 0 }}>
            <Galaxy mouseRepulsion={false} mouseInteraction density={2} glowIntensity={0.2}
              saturation={0} hueShift={140} twinkleIntensity={1} rotationSpeed={0}
              repulsionStrength={2} autoCenterRepulsion={0} starSpeed={0} speed={0} />
          </div>
          <div style={{ position: "absolute", inset: 0 }}>
            <ForceGraph3D ref={fgRef} graphData={graphData} nodeLabel=""
              backgroundColor="rgba(0,0,0,0)" numDimensions={2}
              nodeThreeObject={makeStarObject} nodeThreeObjectExtend={false}
              linkColor={() => "#6366f1"} linkWidth={1.5}
              linkDirectionalArrowLength={6} linkDirectionalArrowRelPos={1}
              onNodeClick={(n: any) => zoomToNode(n.id)} onBackgroundClick={handleBackReset} />
          </div>
        </>
      )}
      {showBack && !selectedItem && (
        <button onClick={handleBackReset}
          className="absolute top-6 left-6 z-10 rounded-lg border border-border bg-popover/85 backdrop-blur-md px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-popover transition-colors">
          Back to full view
        </button>
      )}
      {profile && (
        <div className="absolute right-6 top-6 z-10 max-w-sm rounded-xl border border-emerald-300/25 bg-emerald-300/10 px-4 py-3 text-sm text-emerald-50 backdrop-blur-md">
          <p className="font-medium">Profile captured</p>
          <p className="mt-1 text-emerald-100/85">
            Age {profile.age}, {profile.currentJob}, family intent: {profile.familyIntent}
          </p>
        </div>
      )}
      {selectedItem && (
        <aside className="absolute left-0 top-0 z-10 flex h-full w-[360px] flex-col gap-6 border-r border-white/10 bg-gradient-to-b from-slate-950/90 via-slate-900/80 to-slate-950/90 px-7 py-8 backdrop-blur-xl">
          <button
            onClick={handleBackReset}
            className="self-start rounded-lg border border-border bg-popover/40 px-3.5 py-2 text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground hover:bg-accent transition-colors"
          >
            Back
          </button>
          <div className="space-y-1.5 text-center">
            <h2 className="text-xl font-semibold leading-tight text-primary">{selectedItem.name}</h2>
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
              <span className="text-primary/80">{selectedIndex + 1}</span> of {trajectory?.length}
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <button
              onClick={prevItem ? () => zoomToNode(prevItem.name) : undefined}
              disabled={!prevItem}
              aria-hidden={!prevItem}
              className={`w-full rounded-lg border border-border bg-popover/40 px-4 py-2.5 text-left text-sm font-medium hover:bg-accent transition-colors ${!prevItem ? "invisible" : ""}`}
            >
              <span className="block text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Previous</span>
              <span className="block truncate text-white">{prevItem?.name ?? ""}</span>
            </button>
            <button
              onClick={nextItem ? () => zoomToNode(nextItem.name) : undefined}
              disabled={!nextItem}
              aria-hidden={!nextItem}
              className={`w-full rounded-lg border border-border bg-popover/40 px-4 py-2.5 text-right text-sm font-medium hover:bg-accent transition-colors ${!nextItem ? "invisible" : ""}`}
            >
              <span className="block text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Next</span>
              <span className="block truncate text-white">{nextItem?.name ?? ""}</span>
            </button>
          </div>
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
