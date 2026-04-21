"use client";

import dynamic from "next/dynamic";
import Galaxy from "@/components/Galaxy";
import { CareerHistoryDialog } from "@/components/CareerHistoryDialog";
import { useRef, useState, useCallback, useEffect } from "react";

const ForceGraph3D = dynamic(() => import("react-force-graph-3d"), { ssr: false });

const NODES = [
  { id: "Junior Developer",         fx:    0, fy:   0, info: "Entry-level role. 0–2 years experience. Focus on learning fundamentals and writing clean code." },
  { id: "Mid-level Developer",      fx:    0, fy: 120, info: "2–5 years. Independent contributor. Owns features end-to-end with minimal guidance." },
  { id: "Senior Developer",         fx:    0, fy: 240, info: "5+ years. Mentors others and drives technical decisions across the team." },
  { id: "Staff Engineer",           fx: -200, fy: 360, info: "Cross-team technical leadership. Defines standards and shapes architecture." },
  { id: "Principle Engineer",       fx: -200, fy: 480, info: "Organisation-wide technical influence. Sets the long-term engineering roadmap." },
  { id: "Distinguished Engineer",   fx: -200, fy: 600, info: "Industry-recognised technical leader. Defines engineering culture and innovation." },
  { id: "Engineering Manager",      fx:  200, fy: 360, info: "People management. Responsible for team health, growth, and delivery." },
  { id: "Director of Engineering",  fx:  200, fy: 480, info: "Manages engineering managers. Owns a product area's full engineering organisation." },
  { id: "VP of Engineering",        fx:  200, fy: 600, info: "Senior leader across multiple orgs. Aligns engineering strategy to business goals." },
  { id: "Chief Technology Officer", fx:    0, fy: 720, info: "Executive. Sets the company-wide technology vision and strategy." },
];

const LINKS = [
  { source: "Junior Developer",        target: "Mid-level Developer" },
  { source: "Mid-level Developer",     target: "Senior Developer" },
  { source: "Senior Developer",        target: "Staff Engineer" },
  { source: "Staff Engineer",          target: "Principle Engineer" },
  { source: "Principle Engineer",      target: "Distinguished Engineer" },
  { source: "Distinguished Engineer",  target: "Chief Technology Officer" },
  { source: "Senior Developer",        target: "Engineering Manager" },
  { source: "Engineering Manager",     target: "Director of Engineering" },
  { source: "Director of Engineering", target: "VP of Engineering" },
  { source: "VP of Engineering",       target: "Chief Technology Officer" },
];

// ForceGraph3D mutates link objects in place, so pass copies
const graphData = { nodes: NODES, links: LINKS.map((l) => ({ ...l })) };

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
  const [dialogOpen, setDialogOpen] = useState(true);
  const [careerHistory, setCareerHistory] = useState<string[] | null>(null);

  function handleHistorySubmit(history: string[]) {
    setCareerHistory(history);
    setDialogOpen(false);
  }

  useEffect(() => {
    const lockControls = setInterval(() => {
      try { fgRef.current?.controls?.().enabled === true && (fgRef.current.controls().enabled = false); } catch {}
    }, 200);
    const initialFit = setTimeout(() => fgRef.current?.zoomToFit(600, 20), 800);
    return () => { clearInterval(lockControls); clearTimeout(initialFit); };
  }, []);

  const zoomToNode = useCallback((id: string) => {
    const { fx: x, fy: y } = NODES.find((n) => n.id === id)!;
    setSelectedNode(id);
    setShowBack(true);
    fgRef.current?.cameraPosition({ x, y, z: 350 }, { x, y, z: 0 }, 900);
  }, []);

  const handleBackReset = useCallback(() => {
    setSelectedNode(null);
    setShowBack(false);
    const fg = fgRef.current;
    if (!fg) return;
    fg.cameraPosition({ x: 0, y: 360, z: 1500 }, { x: 0, y: 360, z: 0 }, 0);
    setTimeout(() => fg.zoomToFit(600, 20), 50);
  }, []);

  const node = NODES.find((n) => n.id === selectedNode);
  const successors = LINKS.filter((l) => l.source === selectedNode).map((l) => l.target);

  return (
    <div className="dark" style={{ position: "relative", width: "100vw", height: "100vh", background: "#0a0a0a" }}>
      <CareerHistoryDialog open={dialogOpen} onSubmit={handleHistorySubmit} />
      {careerHistory && (
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
      {showBack && (
        <button onClick={handleBackReset}
          className="absolute top-6 left-6 z-10 rounded-lg border border-border bg-popover/85 backdrop-blur-md px-4 py-2 text-sm font-medium text-popover-foreground hover:bg-popover transition-colors">
          Back to full view
        </button>
      )}
      {node && (
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-10 w-[90%] max-w-[420px] rounded-xl border border-border bg-popover/85 backdrop-blur-md px-7 py-5 text-center text-popover-foreground">
          <h2 className="mb-2.5 text-[18px] font-semibold text-primary">{node.id}</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">{node.info}</p>
          {successors.length > 0 && (
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {successors.map((id) => (
                <button key={id} onClick={() => zoomToNode(id)}
                  className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent transition-colors">
                  {id}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
