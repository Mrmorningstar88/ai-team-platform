import { useEffect, useRef, useState, type ReactNode } from "react";
import { roleById } from "../../shared/roles";
import { DEMO_AGENTS, DESKS, STORY, type DemoAgent } from "../demo";
import { useReducedMotion } from "./useReducedMotion";

// Isometric projection: one floor tile is 64×32 px on screen.
const TW = 32;
const TH = 16;
const ROOM_W = 15;
const ROOM_D = 12;
const WALL_H = 80;

// One beat: the sender works and talks, the item flies, the receiver catches it.
const PREP_MS = 1100;
const FLY_MS = 1700;
const LAND_MS = 1300;
const BEAT_MS = PREP_MS + FLY_MS + LAND_MS;

const SHIRT: Record<string, string> = {
  ceo: "#7a5bc0",
  techlead: "#2f6fc4",
  qa: "#1f8a9c",
  seo: "#c07a1f",
  content: "#c0466a",
  analyst: "#2c8a5c",
};

type Pt = [number, number];
const iso = (x: number, y: number): Pt => [(x - y) * TW, (x + y) * TH];
const pts = (a: Pt[]) => a.map((p) => p.join(",")).join(" ");
const up = (p: Pt, h: number): Pt => [p[0], p[1] - h];

function box(x: number, y: number, w: number, d: number, h: number, cls: [string, string, string]) {
  const a = iso(x, y), b = iso(x + w, y), c = iso(x + w, y + d), e = iso(x, y + d);
  return (
    <>
      <polygon className={cls[1]} points={pts([e, c, up(c, h), up(e, h)])} />
      <polygon className={cls[2]} points={pts([b, c, up(c, h), up(b, h)])} />
      <polygon className={cls[0]} points={pts([up(a, h), up(b, h), up(c, h), up(e, h)])} />
    </>
  );
}

/** Screen point of a seated person's head, used as the start and end of flights. */
function headOf(id: string): Pt {
  const d = DESKS[id];
  if (!d) return [0, 0];
  if (id === "site") return up(iso(d.x + 0.6, d.y + 0.6), 96);
  const [px, py] = iso(d.x + 0.8, d.y + 1.5);
  return [px, py - 40];
}

function Bubble({ x, y, text, tone }: { x: number; y: number; text: string; tone: "say" | "got" }) {
  const w = text.length * 7.2 + 24;
  return (
    <g className={`scene-bubble ${tone}`} transform={`translate(${x} ${y})`}>
      <rect x={-w / 2} y={-30} width={w} height={26} rx={13} />
      <path d="M-6 -5 L0 4 L6 -5 Z" />
      <text x={0} y={-13} textAnchor="middle">{text}</text>
    </g>
  );
}

function Person({ agent, x, y, mode, onPick }: {
  agent: DemoAgent;
  x: number;
  y: number;
  mode: "working" | "waiting" | "idle" | "busy" | "catch";
  onPick: (a: DemoAgent) => void;
}) {
  const [px, py] = iso(x + 0.8, y + 1.5);
  const [mx, my] = iso(x + 0.8, y + 0.4);
  const role = roleById(agent.role);
  const screenOn = mode !== "idle";
  const w = agent.name.length * 7 + 18;
  return (
    <g
      className={`person m-${mode}`}
      role="button"
      tabIndex={0}
      aria-label={`${agent.name}: ${agent.task}`}
      onClick={() => onPick(agent)}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onPick(agent))}
    >
      {box(x, y, 1.6, 0.8, 14, ["s-desk-top", "s-desk-l", "s-desk-r"])}
      <rect className="s-screen" x={mx - 13} y={my - 38} width={26} height={18} rx={2} />
      {screenOn && <rect className="s-screen-on" x={mx - 11} y={my - 36} width={22} height={14} rx={1} />}
      {screenOn && (
        <g className="s-code" aria-hidden>
          <rect x={mx - 9} y={my - 34} width={12} height={2} rx={1} />
          <rect x={mx - 9} y={my - 30} width={16} height={2} rx={1} />
          <rect x={mx - 9} y={my - 26} width={9} height={2} rx={1} />
        </g>
      )}
      <ellipse className="s-chair" cx={px} cy={py} rx={12} ry={6} />
      <g className="s-body">
        <rect x={px - 8} y={py - 24} width={16} height={20} rx={7} fill={SHIRT[agent.role] ?? "#888"} />
        <circle className="s-skin" cx={px} cy={py - 31} r={7.5} />
        <rect className="s-skin s-arm-l" x={px - 12} y={py - 20} width={4} height={11} rx={2} />
        <rect className="s-skin s-arm-r" x={px + 8} y={py - 20} width={4} height={11} rx={2} />
      </g>
      {mode === "catch" && <circle className="s-ring" cx={px} cy={py - 18} r={22} />}
      <text className="s-emoji" x={px} y={py + 34} textAnchor="middle" aria-hidden>{role?.icon}</text>
      <rect className="s-tag" x={px - w / 2} y={py + 6} width={w} height={18} rx={9} />
      <text className="s-name" x={px} y={py + 19} textAnchor="middle">{agent.name}</text>
    </g>
  );
}

interface Props {
  onPick: (a: DemoAgent) => void;
}

/**
 * A living office: everyone sits at a desk, and a story loops on top of it.
 * Each beat, one person works and says what they are doing, then the item
 * flies to the next person, and the caption explains the step in plain words.
 */
export function OfficeScene({ onPick }: Props) {
  const reduced = useReducedMotion();
  const [beat, setBeat] = useState(0);
  const [elapsed, setElapsed] = useState(reduced ? BEAT_MS : 0);
  const [playing, setPlaying] = useState(true);
  const startRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // On narrow screens the scene scrolls sideways; start centred on the team.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
  }, []);

  useEffect(() => {
    if (reduced || !playing) return;
    let frame = 0;
    startRef.current = performance.now() - elapsed;
    const tick = (now: number) => {
      const t = now - startRef.current;
      if (t >= BEAT_MS) {
        setBeat((b) => (b + 1) % STORY.length);
        startRef.current = now;
        setElapsed(0);
      } else {
        setElapsed(t);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // elapsed is read once on (re)start so a pause resumes where it stopped.
  }, [reduced, playing]);

  function jump(i: number) {
    setBeat(i);
    setElapsed(reduced ? BEAT_MS : 0);
    startRef.current = performance.now();
  }

  const story = STORY[beat]!;
  const phase = elapsed < PREP_MS ? "prep" : elapsed < PREP_MS + FLY_MS ? "fly" : "land";
  const flyT = phase === "prep" ? 0 : phase === "fly" ? (elapsed - PREP_MS) / FLY_MS : 1;
  const ease = flyT < 0.5 ? 2 * flyT * flyT : 1 - (-2 * flyT + 2) ** 2 / 2;
  const [fx, fy] = headOf(story.from);
  const [tx, ty] = headOf(story.to);
  const lift = Math.sin(Math.PI * ease) * 70;
  const ex = fx + (tx - fx) * ease;
  const ey = fy + (ty - fy) * ease - lift;

  const modeOf = (id: string, base: DemoAgent["status"]) => {
    if (id === story.from && phase !== "land") return "busy" as const;
    if (id === story.to && phase === "land") return "catch" as const;
    return base;
  };

  const people: { depth: number; node: ReactNode }[] = DEMO_AGENTS.map((a) => {
    const d = DESKS[a.id]!;
    return {
      depth: d.x + d.y,
      node: <Person key={a.id} agent={a} x={d.x} y={d.y} mode={modeOf(a.id, a.status)} onPick={onPick} />,
    };
  });
  people.sort((p, q) => p.depth - q.depth);

  const owner = DESKS.owner!;
  const site = DESKS.site!;
  const [ox, oy] = iso(owner.x + 0.8, owner.y + 0.8);
  const ownerCatch = story.to === "owner" && phase === "land";
  const ownerBusy = story.from === "owner" && phase !== "land";
  const siteCatch = story.to === "site" && phase === "land";
  const [sx, sy] = iso(site.x + 0.6, site.y + 0.6);

  // Framed around the desks rather than the whole room, so people read larger;
  // the room's far corners fall outside the frame.
  const vbX = -250;
  const vbY = -WALL_H - 40;
  const vbW = 700;
  const vbH = 570;

  const sayer = headOf(story.from);
  const catcher = headOf(story.to);

  return (
    <section className="office-scene card" aria-label="Офис: как команда работает прямо сейчас">
      <div className="scene-scroll" ref={scrollRef}>
      <svg viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`} role="group">
        {/* Room */}
        <polygon className="s-wall-l" points={pts([iso(0, 0), iso(0, ROOM_D), up(iso(0, ROOM_D), WALL_H), up(iso(0, 0), WALL_H)])} />
        <polygon className="s-wall-r" points={pts([iso(0, 0), iso(ROOM_W, 0), up(iso(ROOM_W, 0), WALL_H), up(iso(0, 0), WALL_H)])} />
        <polygon className="s-floor" points={pts([iso(0, 0), iso(ROOM_W, 0), iso(ROOM_W, ROOM_D), iso(0, ROOM_D)])} />
        {Array.from({ length: ROOM_W - 1 }, (_, i) => {
          const a = iso(i + 1, 0), b = iso(i + 1, ROOM_D);
          return <line key={`x${i}`} className="s-floor-line" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />;
        })}
        {Array.from({ length: ROOM_D - 1 }, (_, j) => {
          const a = iso(0, j + 1), b = iso(ROOM_W, j + 1);
          return <line key={`y${j}`} className="s-floor-line" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />;
        })}
        {/* Goal banner on the back wall */}
        <g transform={`translate(${iso(7, 0)[0]} ${iso(7, 0)[1] - WALL_H + 18})`}>
          <rect className="s-banner" x={-120} y={0} width={240} height={30} rx={6} />
          <text className="s-banner-text" x={0} y={20} textAnchor="middle">🎯 Цель: больше переходов</text>
        </g>

        {people.map((p) => p.node)}

        {/* The live site: a server rack with a globe */}
        <g className={`s-site ${siteCatch ? "glow" : ""}`}>
          {box(site.x, site.y, 1.2, 1.2, 70, ["s-rack-top", "s-rack-l", "s-rack-r"])}
          <text x={sx} y={sy - 40} textAnchor="middle" className="s-globe" aria-hidden>🌐</text>
          <text x={sx} y={sy + 22} textAnchor="middle" className="s-name">Сайт</text>
        </g>

        {/* The owner's spot */}
        <g className={`s-owner ${ownerCatch ? "catch" : ""} ${ownerBusy ? "busy" : ""}`}>
          {box(owner.x, owner.y, 1.6, 1.6, 6, ["s-rug-top", "s-rug-l", "s-rug-r"])}
          <circle className="s-owner-body" cx={ox} cy={oy - 18} r={14} />
          <text x={ox} y={oy - 12} textAnchor="middle" aria-hidden>👤</text>
          {ownerCatch && <circle className="s-ring" cx={ox} cy={oy - 18} r={24} />}
          <rect className="s-tag accent" x={ox - 20} y={oy + 4} width={40} height={18} rx={9} />
          <text className="s-name on-accent" x={ox} y={oy + 17} textAnchor="middle">Вы</text>
        </g>

        {/* Speech: the sender explains, then the receiver confirms */}
        {phase !== "land" && <Bubble x={sayer[0]} y={sayer[1] - 14} text={story.says} tone="say" />}
        {phase === "land" && <Bubble x={catcher[0]} y={catcher[1] - 14} text="Принято" tone="got" />}

        {/* Flight path and the travelling item */}
        {phase === "fly" && (
          <path
            className="s-trail"
            d={`M${fx} ${fy} Q${(fx + tx) / 2} ${(fy + ty) / 2 - 140} ${tx} ${ty}`}
          />
        )}
        {phase !== "land" && (
          <g className="s-envelope" transform={`translate(${ex} ${ey})`}>
            <rect className="s-env-body" x={-14} y={-10} width={28} height={20} rx={3} />
            <path className="s-env-flap" d="M-14 -10 L0 2 L14 -10" />
            <g transform="translate(18 -12)">
              <rect x={0} y={-9} width={story.item.length * 7 + 14} height={18} rx={9} className="s-env-tag" />
              <text x={7} y={4}>{story.item}</text>
            </g>
          </g>
        )}
      </svg>
      </div>

      <div className="story">
        <div className="story-dots" role="tablist" aria-label="Шаги истории">
          {STORY.map((s, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === beat}
              aria-label={`Шаг ${i + 1}: ${s.item}`}
              className={`story-dot ${i < beat ? "done" : ""} ${i === beat ? "active" : ""}`}
              onClick={() => jump(i)}
            >
              {i === beat && !reduced && (
                <span className="story-dot-fill" style={{ transform: `scaleX(${elapsed / BEAT_MS})` }} />
              )}
            </button>
          ))}
        </div>
        <div className="story-text" key={beat} aria-live="polite">
          <strong>Шаг {beat + 1} из {STORY.length}.</strong> {story.explain}
        </div>
        <div className="flow-controls">
          {!reduced && (
            <button type="button" className="btn btn-plain" onClick={() => setPlaying((p) => !p)}>
              {playing ? "Пауза" : "Смотреть"}
            </button>
          )}
          <button type="button" className="btn btn-plain" onClick={() => jump((beat + 1) % STORY.length)}>
            Следующий шаг →
          </button>
        </div>
      </div>
    </section>
  );
}
