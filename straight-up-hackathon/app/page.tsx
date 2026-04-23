"use client";

import dynamic from "next/dynamic";
import Galaxy from "@/components/Galaxy";
import { CareerHistoryDialog } from "@/components/CareerHistoryDialog";
import { ProfileIntakeDialog } from "@/components/ProfileIntakeDialog";
import { useRef, useState, useEffect, useMemo } from "react";
import type { UserProfile } from "@/lib/chat";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL;
const ForceGraph3D = dynamic(() => import("react-force-graph-3d"), { ssr: false });

const NODE_SPACING = 120;
const SIDEBAR_WIDTH = 360;
const NODE_CAMERA_Z = 350;
const FIT_VIEW_Y = 360;
const FIT_VIEW_Z = 1500;
const FIT_DURATION_MS = 600;
const ZOOM_DURATION_MS = 900;

type TrajectoryItem = { name: string; description: string };

function trajectoryToGraphData(trajectory: TrajectoryItem[]) {
  return {
    nodes: trajectory.map((item, i) => ({ id: item.name, fx: 0, fy: i * NODE_SPACING })),
    links: trajectory.slice(0, -1).map((item, i) => ({ source: item.name, target: trajectory[i + 1].name })),
  };
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

const NAV_BTN_BASE = "w-full rounded-lg border border-border bg-popover/40 px-4 py-2.5 text-sm font-medium hover:bg-accent transition-colors";

function NavButton({ item, label, align, onSelect }: {
  item: TrajectoryItem | undefined;
  label: string;
  align: "left" | "right";
  onSelect: (name: string) => void;
}) {
  const alignClass = align === "left" ? "text-left" : "text-right";
  return (
    <button
      onClick={item ? () => onSelect(item.name) : undefined}
      disabled={!item}
      aria-hidden={!item}
      className={`${NAV_BTN_BASE} ${alignClass} ${item ? "" : "invisible"}`}
    >
      <span className="block text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{label}</span>
      <span className="block truncate text-white">{item?.name ?? ""}</span>
    </button>
  );
}

export default function Page() {
  const fgRef = useRef<any>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [activeDialog, setActiveDialog] = useState<"history" | "profile" | null>("history");
  const [trajectory, setTrajectory] = useState<TrajectoryItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);

  const graphData = useMemo(() => (trajectory ? trajectoryToGraphData(trajectory) : null), [trajectory]);

  const selectedIndex = trajectory?.findIndex((item) => item.name === selectedNode) ?? -1;
  const selectedItem = selectedIndex >= 0 ? trajectory?.[selectedIndex] : undefined;
  const prevItem = selectedIndex > 0 ? trajectory?.[selectedIndex - 1] : undefined;
  const nextItem = selectedIndex >= 0 ? trajectory?.[selectedIndex + 1] : undefined;

  async function handleHistorySubmit(history: string[]) {
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/predict-trajectory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history }),
      });
      setTrajectory(await res.json());
      setActiveDialog(null);
    } finally {
      setLoading(false);
    }
  }

  // Lock orbit controls and fit the view once the graph mounts.
  useEffect(() => {
    if (!graphData) return;
    const lockControls = setInterval(() => {
      try { fgRef.current?.controls?.().enabled === true && (fgRef.current.controls().enabled = false); } catch {}
    }, 200);
    const initialFit = setTimeout(() => fgRef.current?.zoomToFit(FIT_DURATION_MS, 20), 800);
    return () => { clearInterval(lockControls); clearTimeout(initialFit); };
  }, [graphData]);

  function zoomToNode(id: string) {
    const index = trajectory?.findIndex((item) => item.name === id) ?? -1;
    if (index < 0) return;
    // Shift the camera target left so the node lands centered in the area to the right of the sidebar.
    const fov = fgRef.current?.camera()?.fov ?? 50;
    const visibleHeight = 2 * NODE_CAMERA_Z * Math.tan((fov / 2) * Math.PI / 180);
    const offsetX = -(SIDEBAR_WIDTH / 2) * (visibleHeight / window.innerHeight);
    const y = index * NODE_SPACING;
    setSelectedNode(id);
    fgRef.current?.cameraPosition({ x: offsetX, y, z: NODE_CAMERA_Z }, { x: offsetX, y, z: 0 }, ZOOM_DURATION_MS);
  }

  function handleBackReset() {
    setSelectedNode(null);
    const fg = fgRef.current;
    if (!fg) return;
    fg.cameraPosition({ x: 0, y: FIT_VIEW_Y, z: FIT_VIEW_Z }, { x: 0, y: FIT_VIEW_Y, z: 0 }, 0);
    setTimeout(() => fg.zoomToFit(FIT_DURATION_MS, 20), 50);
  }

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
        onProfileCaptured={(p) => { setProfile(p); setActiveDialog("history"); }}
      />
      {graphData && (
        <>
          <div className="absolute inset-0">
            <Galaxy mouseRepulsion={false} mouseInteraction density={2} glowIntensity={0.2}
              saturation={0} hueShift={140} twinkleIntensity={1} rotationSpeed={0}
              repulsionStrength={2} autoCenterRepulsion={0} starSpeed={0} speed={0} />
          </div>
          <div className="absolute inset-0">
            <ForceGraph3D ref={fgRef} graphData={graphData} nodeLabel=""
              backgroundColor="rgba(0,0,0,0)" numDimensions={2}
              nodeThreeObject={makeStarObject} nodeThreeObjectExtend={false}
              linkColor={() => "#6366f1"} linkWidth={1.5}
              linkDirectionalArrowLength={6} linkDirectionalArrowRelPos={1}
              onNodeClick={(n: any) => zoomToNode(n.id)} onBackgroundClick={handleBackReset} />
          </div>
        </>
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
            <NavButton item={prevItem} label="Previous" align="left" onSelect={zoomToNode} />
            <NavButton item={nextItem} label="Next" align="right" onSelect={zoomToNode} />
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
