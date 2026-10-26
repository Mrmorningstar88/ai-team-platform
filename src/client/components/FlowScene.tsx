import { useEffect, useRef, useState, type CSSProperties } from "react";
import { roleById } from "../../shared/roles";
import { DEMO_AGENTS, STORY, type DemoAgent } from "../demo";
import { FLY_MS, PREP_MS, StoryPanel, useStoryClock } from "./story";
import { useMediaQuery } from "./useMediaQuery";

type Pt = [number, number];

/**
 * The team as a live workflow graph. Every employee is a node with its tools
 * hanging below; a task travels between nodes as a burning comet, the node it
 * hits ignites, and its tools light up blue while it works. The camera
 * follows the task, so the same graph fits a phone and a desktop.
 */

// Node centres in world pixels, laid out left to right in story order.
const NODES: Record<string, Pt> = {
  a6: [-380, -20],
  a1: [0, 0],
  a4: [380, -60],
  a2: [760, 0],
  a3: [760, -380],
  owner: [1140, 40],
  site: [1500, 0],
  a5: [380, 420],
};

const TILE = 92;
const TOOL_Y = 190;
const TOOL_DX = 132;
/** Тестировщик sits above Техлид, so its tools hang upward, clear of the wires between them. */
const toolDir = (id: string) => (id === "a3" ? -1 : 1);

/** Static wires; story beats travel along these. CEO → Контент is a standing assignment. */
const WIRES: [string, string][] = [
  ...STORY.map((b) => [b.from, b.to] as [string, string]),
  ["a1", "a5"],
];

type Bezier = [Pt, Pt, Pt, Pt];

/** n8n-style wire: out of the sender's right (or top/bottom) port into the receiver's opposite port. */
function wire(from: string, to: string): Bezier {
  const [x1, y1] = NODES[from]!;
  const [x2, y2] = NODES[to]!;
  const h = TILE / 2;
  if (Math.abs(x2 - x1) >= Math.abs(y2 - y1)) {
    const dir = Math.sign(x2 - x1) || 1;
    const a: Pt = [x1 + h * dir, y1];
    const b: Pt = [x2 - h * dir, y2];
    const k = Math.max(90, Math.abs(b[0] - a[0]) * 0.5) * dir;
    return [a, [a[0] + k, a[1]], [b[0] - k, b[1]], b];
  }
  // Vertical pair (Техлид ↔ Тестировщик): two parallel wires, one each way.
  const dir = Math.sign(y2 - y1);
  const side = dir < 0 ? -22 : 22;
  const a: Pt = [x1 + side, y1 + h * dir];
  const b: Pt = [x2 + side, y2 - h * dir];
  const k = Math.abs(b[1] - a[1]) * 0.45 * dir;
  return [a, [a[0], a[1] + k], [b[0], b[1] - k], b];
}

function at([p0, p1, p2, p3]: Bezier, t: number): Pt {
  const u = 1 - t;
  const w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
  return [
    w0 * p0[0] + w1 * p1[0] + w2 * p2[0] + w3 * p3[0],
    w0 * p0[1] + w1 * p1[1] + w2 * p2[1] + w3 * p3[1],
  ];
}

const pathOf = ([a, b, c, d]: Bezier) => `M${a[0]} ${a[1]} C${b[0]} ${b[1]} ${c[0]} ${c[1]} ${d[0]} ${d[1]}`;

/** Points along the wire from t0 to t1, for the part the comet has already burned. */
function partial(bz: Bezier, t0: number, t1: number, n = 24) {
  const out: string[] = [];
  for (let i = 0; i <= n; i++) out.push(at(bz, t0 + ((t1 - t0) * i) / n).join(","));
  return out.join(" ");
}

const ease = (c: number) => (c < 0.5 ? 4 * c * c * c : 1 - (-2 * c + 2) ** 3 / 2);

// Deterministic pseudo-random numbers so sparks do not flicker between renders.
const rand = (i: number, k: number) => {
  const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

const SPARKS = 34;
const BURST = 26;
const BURST_MS = 750;

function Comet({ bz, t, now }: { bz: Bezier; t: number; now: number }) {
  const head = at(bz, t);
  const trail: { d: string; w: number; o: number; c: string }[] = [];
  const steps = 12;
  for (let i = 0; i < steps; i++) {
    const a = Math.max(0, t - ((i + 1) * 0.16) / steps);
    const b = Math.max(0, t - (i * 0.16) / steps);
    if (b <= 0) break;
    const k = i / steps;
    trail.push({ d: partial(bz, a, b, 3), w: 9 * (1 - k) + 1, o: 1 - k * 0.9, c: k < 0.2 ? "#fff3d6" : k < 0.5 ? "#ffb347" : "#ff5a1f" });
  }
  const sparks = Array.from({ length: SPARKS }, (_, i) => {
    const life = ((now / 520 + i / SPARKS) % 1 + 1) % 1;
    const t0 = Math.max(0, t - rand(i, 1) * 0.1);
    const [bx, by] = at(bz, t0);
    const ang = rand(i, 2) * Math.PI * 2;
    const dist = life * (14 + rand(i, 3) * 34);
    return {
      x: bx + Math.cos(ang) * dist,
      y: by + Math.sin(ang) * dist + life * life * 18,
      r: (1 - life) * (1.2 + rand(i, 4) * 1.8),
      c: rand(i, 5) > 0.5 ? "#ffd27a" : "#ff7a2a",
    };
  });
  return (
    <g className="fx-comet">
      <g filter="url(#fx-glow)">
        {trail.map((s, i) => (
          <polyline key={i} points={s.d} stroke={s.c} strokeWidth={s.w} strokeOpacity={s.o} fill="none" strokeLinecap="round" />
        ))}
      </g>
      {sparks.map((s, i) => <circle key={i} cx={s.x} cy={s.y} r={s.r} fill={s.c} />)}
      <circle cx={head[0]} cy={head[1]} r={14} fill="#ff8a1f" opacity={0.35} filter="url(#fx-glow)" />
      <circle cx={head[0]} cy={head[1]} r={6} fill="#fff6e0" filter="url(#fx-glow)" />
    </g>
  );
}

function Burst({ x, y, p }: { x: number; y: number; p: number }) {
  return (
    <g>
      {Array.from({ length: BURST }, (_, i) => {
        const ang = (i / BURST) * Math.PI * 2 + rand(i, 7) * 0.4;
        const d = TILE * 0.55 + ease(Math.min(1, p * 1.4)) * (30 + rand(i, 8) * 50);
        return (
          <circle key={i} cx={x + Math.cos(ang) * d} cy={y + Math.sin(ang) * d} r={Math.max(0, (1 - p) * 2.6)}
            fill={i % 2 ? "#ffd27a" : "#ff7a2a"} />
        );
      })}
    </g>
  );
}

interface NodeProps {
  id: string;
  label: string;
  sub: string;
  icon: string;
  state: "idle" | "hot" | "work";
  shape?: "tile" | "ring";
  onPick?: () => void;
}

function Node({ id, label, sub, icon, state, shape = "tile", onPick }: NodeProps) {
  const [x, y] = NODES[id]!;
  const style = { left: x, top: y } as CSSProperties;
  const inner = (
    <>
      <span className={`fx-tile ${shape}`}>
        <span className="fx-port in" aria-hidden />
        <span className="fx-port out" aria-hidden />
        <span className="fx-icon" aria-hidden>{icon}</span>
      </span>
      <span className="fx-label">{label}</span>
      <span className="fx-sub">{sub}</span>
    </>
  );
  return onPick ? (
    <button type="button" className={`fx-node s-${state}`} style={style} onClick={onPick} aria-label={`${label}: ${sub}`}>
      {inner}
    </button>
  ) : (
    <div className={`fx-node s-${state}`} style={style}>{inner}</div>
  );
}

interface Props {
  onPick: (a: DemoAgent) => void;
}

export function FlowScene({ onPick }: Props) {
  const phone = useMediaQuery("(max-width: 760px)");
  const clock = useStoryClock();
  const { story, phase, flyT, elapsed, reduced } = clock;
  const bz = wire(story.from, story.to);
  const t = ease(flyT);

  // Camera: rests on the working node, rides the comet, settles on the receiver.
  const target: Pt =
    phase === "prep" ? NODES[story.from]! : phase === "fly" ? at(bz, t) : NODES[story.to]!;
  const goal: Pt = [target[0], target[1] + (phone ? 70 : 60)];
  const goalRef = useRef(goal);
  goalRef.current = goal;
  const [cam, setCam] = useState<Pt>(goal);
  const flying = useRef(false);
  flying.current = phase === "fly";
  useEffect(() => {
    if (reduced) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      const k = 1 - Math.exp(-dt / (flying.current ? 90 : 280));
      setCam(([cx, cy]) => {
        const [gx, gy] = goalRef.current;
        if (Math.abs(gx - cx) < 0.3 && Math.abs(gy - cy) < 0.3) return [cx, cy];
        return [cx + (gx - cx) * k, cy + (gy - cy) * k];
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [reduced]);
  const view = reduced ? goal : cam;

  const now = performance.now();
  const landP = phase === "land" ? (elapsed - PREP_MS - FLY_MS) / BURST_MS : 0;
  const working = phase === "land" ? story.to : story.from;

  const stateOf = (id: string): NodeProps["state"] =>
    phase === "land" && id === story.to ? "hot" : id === working ? "work" : "idle";

  const zoom = phone ? 0.66 : 0.95;
  const world = {
    transform: `rotateX(${phone ? 16 : 20}deg) scale(${zoom}) translate(${-view[0]}px, ${-view[1]}px)`,
  } as CSSProperties;

  const [sx, sy] = NODES[story.to]!;

  return (
    <section className="flow-scene card" aria-label="Как задача проходит через команду">
      <div className="fx-stage">
        <div className="fx-world" style={world}>
          <div className="fx-grid" aria-hidden />
          <svg className="fx-svg" aria-hidden>
            <defs>
              <filter id="fx-glow" x="-100%" y="-100%" width="300%" height="300%">
                <feGaussianBlur stdDeviation="3.5" result="b" />
                <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>

            {/* Every employee's tools hang below them on dashed wires */}
            {DEMO_AGENTS.map((a) => {
              const [x, y] = NODES[a.id]!;
              const lit = a.id === working;
              const s = toolDir(a.id);
              // Downward tools start below the node's caption; upward ones leave from the top edge.
              const y0 = y + (s > 0 ? TILE / 2 + 56 : -TILE / 2);
              const y1 = y + s * (TOOL_Y - 36);
              return [-1, 0, 1].map((k) => (
                <path key={`${a.id}${k}`} className={`fx-tool-wire ${lit ? "lit" : ""}`}
                  d={`M${x} ${y0} C${x} ${y0 + s * 30} ${x + k * TOOL_DX} ${y1 - s * 30} ${x + k * TOOL_DX} ${y1}`} />
              ));
            })}

            {WIRES.map(([f, to], i) => (
              <path key={i} className="fx-wire" d={pathOf(wire(f, to))} />
            ))}
            {WIRES.map(([f, to], i) => {
              const [a, , , d] = wire(f, to);
              return (
                <g key={`p${i}`}>
                  <circle className="fx-dot" cx={a[0]} cy={a[1]} r={4} />
                  <circle className="fx-dot" cx={d[0]} cy={d[1]} r={4} />
                </g>
              );
            })}

            {/* The part of the wire the task has already burned through */}
            {phase !== "prep" && !reduced && (
              <polyline className="fx-burnt" points={partial(bz, 0, t)} filter="url(#fx-glow)" />
            )}
            {phase === "fly" && !reduced && <Comet bz={bz} t={t} now={now} />}
            {phase === "land" && !reduced && landP < 1 && <Burst x={sx} y={sy} p={Math.max(0, landP)} />}
          </svg>

          {DEMO_AGENTS.map((a) => {
            const r = roleById(a.role);
            const [x, y] = NODES[a.id]!;
            const lit = a.id === working;
            return (
              <div key={a.id}>
                <Node id={a.id} label={a.name} sub={a.task} icon={r?.icon ?? "🤖"} state={stateOf(a.id)} onPick={() => onPick(a)} />
                {r?.steps.slice(0, 3).map((s, k) => (
                  <div key={k} className={`fx-tool ${lit ? "lit" : ""}`} style={{ left: x + (k - 1) * TOOL_DX, top: y + toolDir(a.id) * TOOL_Y - (toolDir(a.id) < 0 ? 40 : 0), transitionDelay: `${k * 90}ms` }}>
                    <span className="fx-tool-ring" aria-hidden>{s.icon}</span>
                    <span className="fx-tool-label">{s.title}</span>
                  </div>
                ))}
              </div>
            );
          })}
          <Node id="owner" label="Вы" sub="Одно «да» в день" icon="👤" state={stateOf("owner")} shape="ring" />
          <Node id="site" label="Сайт" sub="freekonomist.com" icon="🌐" state={stateOf("site")} shape="ring" />

          {/* The sender explains; the receiver confirms */}
          {phase !== "land" ? (
            <div className="fx-say" style={{ left: NODES[story.from]![0], top: NODES[story.from]![1] - TILE / 2 - 18 }} key={`s${clock.beat}`}>
              {story.says}
            </div>
          ) : (
            <div className="fx-say got" style={{ left: sx, top: sy - TILE / 2 - 18 }} key={`g${clock.beat}`}>
              Принято
            </div>
          )}
          {phase === "fly" && !reduced && (
            <div className="fx-item" style={{ left: at(bz, t)[0], top: at(bz, t)[1] }}>{story.item}</div>
          )}
        </div>
        <div className="fx-dof" aria-hidden />
        <div className="fx-hud" aria-hidden>
          <span>FLOW://{DEMO_AGENTS.length + 2}_NODES</span>
          <span className="fx-live">● LIVE</span>
        </div>
      </div>
      <StoryPanel clock={clock} />
    </section>
  );
}
