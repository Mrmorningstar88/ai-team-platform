import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { DEMO_AGENTS, DESKS, STORY, type DemoAgent } from "../demo";
import { useMediaQuery } from "./useMediaQuery";
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

/** Neon colour per role: desk edge, hologram, visor and name tag. */
const ROLE_NEON: Record<string, string> = {
  ceo: "#b98cff",
  techlead: "#3db8ff",
  qa: "#00f0d0",
  seo: "#ffb020",
  content: "#ff4fb0",
  analyst: "#3dff9a",
};

type Pt = [number, number];
type Desks = Record<string, { x: number; y: number }>;
const iso = (x: number, y: number): Pt => [(x - y) * TW, (x + y) * TH];
const pts = (a: Pt[]) => a.map((p) => p.join(",")).join(" ");
const up = (p: Pt, h: number): Pt => [p[0], p[1] - h];

/** Tile position whose point (x + dx, y + dy) lands on screen point (sx, sy). */
function fromScreen(sx: number, sy: number, dx: number, dy: number) {
  const u = sy / TH, v = sx / TW;
  return { x: (u + v) / 2 - dx, y: (u - v) / 2 - dy };
}

// Phone layout: two columns down a neon corridor, in story order, so the
// scene fits a portrait screen at nearly full size instead of shrinking.
const PERSON_D = [0.8, 1.5] as const;
const PHONE_DESKS: Desks = {
  a1: fromScreen(-88, 100, ...PERSON_D),
  a6: fromScreen(88, 100, ...PERSON_D),
  a4: fromScreen(-88, 225, ...PERSON_D),
  a5: fromScreen(88, 225, ...PERSON_D),
  a2: fromScreen(-88, 350, ...PERSON_D),
  a3: fromScreen(88, 350, ...PERSON_D),
  owner: fromScreen(-72, 520, 0.8, 0.8),
  site: fromScreen(92, 545, 0.6, 0.6),
};

interface Layout {
  kind: "room" | "corridor";
  desks: Desks;
  frame: [number, number, number, number];
}

const DESKTOP: Layout = { kind: "room", desks: DESKS, frame: [-250, -WALL_H - 40, 700, 570] };
const PHONE: Layout = { kind: "corridor", desks: PHONE_DESKS, frame: [-200, -95, 400, 700] };

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
function headOf(desks: Desks, id: string): Pt {
  const d = desks[id];
  if (!d) return [0, 0];
  if (id === "site") return up(iso(d.x + 0.6, d.y + 0.6), 118);
  if (id === "owner") return up(iso(d.x + 0.8, d.y + 0.8), 46);
  const [px, py] = iso(d.x + PERSON_D[0], d.y + PERSON_D[1]);
  return [px, py - 42];
}

function Bubble({ x, y, text, tone }: { x: number; y: number; text: string; tone: "say" | "got" }) {
  const w = text.length * 7.8 + 24;
  return (
    <g className={`scene-bubble ${tone}`} transform={`translate(${x} ${y})`}>
      <rect x={-w / 2} y={-30} width={w} height={26} rx={2} />
      <path d="M-5 -4 L0 3 L5 -4 Z" />
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
  const [px, py] = iso(x + PERSON_D[0], y + PERSON_D[1]);
  const [mx, my] = iso(x + 0.8, y + 0.4);
  const w = agent.name.length * 7.6 + 18;
  const style = { "--role": ROLE_NEON[agent.role] ?? "#00f0ff" } as CSSProperties;
  return (
    <g
      className={`person m-${mode}`}
      style={style}
      role="button"
      tabIndex={0}
      aria-label={`${agent.name}: ${agent.task}`}
      onClick={() => onPick(agent)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPick(agent);
        }
      }}
    >
      {box(x, y, 1.6, 0.8, 14, ["s-desk-top", "s-desk-l", "s-desk-r"])}
      {/* Floating hologram screen above the desk */}
      <polygon className="s-holo" points={pts([[mx - 17, my - 52], [mx + 17, my - 60], [mx + 17, my - 36], [mx - 17, my - 28]])} />
      <g aria-hidden>
        <rect className="s-holo-line" x={mx - 12} y={my - 50} width={14} height={2} />
        <rect className="s-holo-line" x={mx - 12} y={my - 45} width={20} height={2} />
        <rect className="s-holo-line" x={mx - 12} y={my - 40} width={10} height={2} />
        <rect className="s-scan" x={mx - 16} y={my - 56} width={32} height={1.5} />
      </g>
      <ellipse className="s-pad" cx={px} cy={py} rx={15} ry={7.5} />
      <ellipse cx={px} cy={py} rx={9} ry={4.5} fill="var(--role)" opacity={0.25} />
      <g className="s-figure">
        <rect className="s-arm s-arm-l" x={px - 13} y={py - 22} width={4} height={12} rx={2} />
        <rect className="s-arm s-arm-r" x={px + 9} y={py - 22} width={4} height={12} rx={2} />
        <path className="s-body" d={`M${px - 9} ${py - 4} L${px - 7} ${py - 24} Q${px} ${py - 28} ${px + 7} ${py - 24} L${px + 9} ${py - 4} Z`} />
        <circle className="s-head" cx={px} cy={py - 34} r={8} />
        <rect className="s-visor" x={px - 6.5} y={py - 37} width={13} height={4} rx={2} filter="url(#neon)" />
      </g>
      {mode === "catch" && <circle className="s-ring" cx={px} cy={py - 18} r={24} />}
      <rect className="s-tag" x={px - w / 2} y={py + 9} width={w} height={19} rx={2} />
      <text className="s-name" x={px} y={py + 22} textAnchor="middle">{agent.name}</text>
    </g>
  );
}

function Room({ layout }: { layout: Layout }) {
  if (layout.kind === "corridor") {
    const [fx, fy, fw, fh] = layout.frame;
    const lines: ReactNode[] = [];
    for (let k = -20; k <= 40; k++) {
      const a = iso(k, -30), b = iso(k, 40), c = iso(-30, k), d = iso(40, k);
      lines.push(<line key={`a${k}`} className="s-grid" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />);
      lines.push(<line key={`b${k}`} className="s-grid" x1={c[0]} y1={c[1]} x2={d[0]} y2={d[1]} />);
    }
    return (
      <>
        <clipPath id="corridor"><rect x={fx + 10} y={fy + 10} width={fw - 20} height={fh - 20} /></clipPath>
        <rect className="s-floor" x={fx + 10} y={fy + 10} width={fw - 20} height={fh - 20} />
        <g clipPath="url(#corridor)">{lines}</g>
        <line className="s-neon-strip" x1={fx + 10} y1={fy + 10} x2={fx + 10} y2={fy + fh - 10} filter="url(#neon)" />
        <line className="s-neon-strip cyan" x1={fx + fw - 10} y1={fy + 10} x2={fx + fw - 10} y2={fy + fh - 10} filter="url(#neon)" />
        <ellipse className="s-pulse" cx={0} cy={260} rx={180} ry={90} />
        <ellipse className="s-pulse late" cx={0} cy={260} rx={180} ry={90} />
      </>
    );
  }
  const o = iso(0, 0), l = iso(0, ROOM_D), r = iso(ROOM_W, 0);
  const center = iso(ROOM_W / 2, ROOM_D / 2);
  return (
    <>
      <polygon className="s-wall-l" points={pts([o, l, up(l, WALL_H), up(o, WALL_H)])} />
      <polygon className="s-wall-r" points={pts([o, r, up(r, WALL_H), up(o, WALL_H)])} />
      <polygon className="s-floor" points={pts([o, r, iso(ROOM_W, ROOM_D), l])} />
      {Array.from({ length: ROOM_W - 1 }, (_, i) => {
        const a = iso(i + 1, 0), b = iso(i + 1, ROOM_D);
        return <line key={`x${i}`} className="s-grid" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />;
      })}
      {Array.from({ length: ROOM_D - 1 }, (_, j) => {
        const a = iso(0, j + 1), b = iso(ROOM_W, j + 1);
        return <line key={`y${j}`} className="s-grid" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />;
      })}
      {/* Neon strips along the top of the walls and the floor edge */}
      <polyline className="s-neon-strip" points={pts([up(l, WALL_H), up(o, WALL_H), up(r, WALL_H)])} filter="url(#neon)" />
      <polyline className="s-neon-strip cyan" points={pts([l, o, r])} filter="url(#neon)" />
      {/* Wall display with live bars on the left wall */}
      <g>
        <polygon className="s-wallscreen" points={pts([up(iso(0, 3), 66), up(iso(0, 8), 66), up(iso(0, 8), 16), up(iso(0, 3), 16)])} />
        {[3.6, 4.4, 5.2, 6, 6.8, 7.4].map((t, i) => {
          const [bx, by] = up(iso(0, t), 20);
          return <rect key={t} className={`s-wallbar ${i % 2 ? "m" : ""}`} x={bx - 6} y={by - 36} width={10} height={36}
            style={{ animationDelay: `${i * 0.2}s` }} />;
        })}
      </g>
      <ellipse className="s-pulse" cx={center[0]} cy={center[1]} rx={300} ry={150} />
      <ellipse className="s-pulse late" cx={center[0]} cy={center[1]} rx={300} ry={150} />
    </>
  );
}

const PARTICLES: [number, number, number][] = [
  [-180, 380, 0], [-90, 300, 1.5], [10, 420, 3], [120, 340, 4.5], [220, 400, 6], [320, 300, 2.2], [-40, 200, 7], [160, 220, 5.2],
];

interface Props {
  onPick: (a: DemoAgent) => void;
}

/**
 * A living neon office: everyone sits at a desk, and a story loops on top of
 * it. Each beat, one person works and says what they are doing, then a data
 * packet flies to the next person, and the caption explains the step in plain
 * words. Phones get a portrait corridor layout instead of the wide room.
 */
export function OfficeScene({ onPick }: Props) {
  const reduced = useReducedMotion();
  const phone = useMediaQuery("(max-width: 760px)");
  const layout = phone ? PHONE : DESKTOP;
  const desks = layout.desks;
  const [beat, setBeat] = useState(0);
  const [elapsed, setElapsed] = useState(reduced ? BEAT_MS : 0);
  const [playing, setPlaying] = useState(true);
  const startRef = useRef(0);

  useEffect(() => {
    if (reduced || !playing) return;
    let frame = 0;
    // elapsed is read once on (re)start so a pause resumes where it stopped.
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
  }, [reduced, playing]);

  function jump(i: number) {
    setBeat(i);
    setElapsed(reduced ? BEAT_MS : 0);
    startRef.current = performance.now();
  }

  const story = STORY[beat]!;
  const phase = elapsed < PREP_MS ? "prep" : elapsed < PREP_MS + FLY_MS ? "fly" : "land";
  const flyT = phase === "prep" ? 0 : phase === "fly" ? (elapsed - PREP_MS) / FLY_MS : 1;
  const [fx, fy] = headOf(desks, story.from);
  const [tx, ty] = headOf(desks, story.to);
  const at = (t: number): Pt => {
    const c = Math.min(1, Math.max(0, t));
    const e = c < 0.5 ? 2 * c * c : 1 - (-2 * c + 2) ** 2 / 2;
    return [fx + (tx - fx) * e, fy + (ty - fy) * e - Math.sin(Math.PI * e) * 80];
  };
  const [ex, ey] = at(flyT);

  const modeOf = (id: string, base: DemoAgent["status"]) => {
    if (id === story.from && phase !== "land") return "busy" as const;
    if (id === story.to && phase === "land") return "catch" as const;
    return base;
  };

  const people: { depth: number; node: ReactNode }[] = DEMO_AGENTS.map((a) => {
    const d = desks[a.id]!;
    return {
      depth: d.x + d.y,
      node: <Person key={a.id} agent={a} x={d.x} y={d.y} mode={modeOf(a.id, a.status)} onPick={onPick} />,
    };
  });
  people.sort((p, q) => p.depth - q.depth);

  const owner = desks.owner!;
  const site = desks.site!;
  const [ox, oy] = iso(owner.x + 0.8, owner.y + 0.8);
  const ownerCatch = story.to === "owner" && phase === "land";
  const siteCatch = story.to === "site" && phase === "land";
  const [sx, sy] = iso(site.x + 0.6, site.y + 0.6);
  const rackH = 84;
  const leds: Pt[] = [];
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 6; row++) {
      const [lx, ly] = iso(site.x + 0.2 + col * 0.35, site.y + 1.2);
      leds.push([lx, ly - 14 - row * 11]);
    }
  }

  const sayer = headOf(desks, story.from);
  const catcher = headOf(desks, story.to);
  const hex: Pt[] = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i;
    return [ox + Math.cos(a) * 30, oy + Math.sin(a) * 15];
  });

  return (
    <section className="office-scene card" aria-label="Офис: как команда работает прямо сейчас">
      <div className="scene-scroll">
        <svg viewBox={layout.frame.join(" ")} role="group">
          <defs>
            <filter id="neon" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="2.5" result="b" />
              <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          <Room layout={layout} />

          {/* Goal banner */}
          <g transform={phone ? "translate(0 -88)" : `translate(${iso(7.5, 0)[0]} ${iso(7.5, 0)[1] - WALL_H + 20})`}>
            <rect className="s-banner" x={-130} y={0} width={260} height={28} rx={2} filter="url(#neon)" />
            <text className="s-banner-text" x={0} y={19} textAnchor="middle">ЦЕЛЬ: БОЛЬШЕ ПЕРЕХОДОВ</text>
          </g>

          {PARTICLES.map(([px, py, delay], i) => (
            <circle key={i} className={`s-particle ${i % 2 ? "m" : ""}`} cx={phone ? px * 0.45 : px} cy={py} r={1.6}
              style={{ animationDelay: `${delay}s` }} />
          ))}

          {people.map((p) => p.node)}

          {/* The live site: a server tower with blinking lights and a holographic globe */}
          <g className={`s-site ${siteCatch ? "glow" : ""}`}>
            {box(site.x, site.y, 1.2, 1.2, rackH, ["s-rack-top", "s-rack-l", "s-rack-r"])}
            {leds.map(([lx, ly], i) => (
              <rect key={i} className={`s-led ${i % 3 === 1 ? "c" : i % 3 === 2 ? "m" : ""}`} x={lx - 2} y={ly} width={5} height={2.5}
                style={{ animationDelay: `${(i * 0.17) % 1.3}s` }} />
            ))}
            <g transform={`translate(${sx} ${sy - rackH - 34})`} filter="url(#neon)">
              <circle className="s-globe" r={15} />
              <ellipse className="s-globe" rx={15} ry={5} />
              <ellipse className="s-globe s-globe-spin" rx={15} ry={15} />
            </g>
            {siteCatch && <circle className="s-ring" cx={sx} cy={sy - rackH - 34} r={24} />}
            <rect className="s-tag" x={sx - 28} y={sy + 8} width={56} height={19} rx={2} />
            <text className="s-name" x={sx} y={sy + 21} textAnchor="middle">САЙТ</text>
          </g>

          {/* The owner's spot: a magenta hex pad */}
          <g className="s-owner">
            <polygon className="s-hex" points={pts(hex)} filter="url(#neon)" />
            <ellipse className="s-hex-ring" cx={ox} cy={oy} rx={38} ry={19} />
            <path className="s-owner-figure" d={`M${ox - 13} ${oy - 4} Q${ox - 12} ${oy - 26} ${ox} ${oy - 27} Q${ox + 12} ${oy - 26} ${ox + 13} ${oy - 4} Z`} />
            <circle className="s-owner-figure" cx={ox} cy={oy - 36} r={9} />
            <rect x={ox - 7} y={oy - 39} width={14} height={4} rx={2} fill="var(--accent-2)" filter="url(#neon)" />
            {ownerCatch && <circle className="s-ring" cx={ox} cy={oy - 22} r={28} />}
            <rect className="s-tag" x={ox - 20} y={oy + 20} width={40} height={19} rx={2} />
            <text className="s-name" x={ox} y={oy + 33} textAnchor="middle">ВЫ</text>
          </g>

          {/* Speech: the sender explains, then the receiver confirms */}
          {phase !== "land" && <Bubble x={sayer[0]} y={sayer[1] - 12} text={story.says} tone="say" />}
          {phase === "land" && <Bubble x={catcher[0]} y={catcher[1] - 12} text="Принято" tone="got" />}

          {/* Flight path and the travelling data packet with its spark trail */}
          {phase === "fly" && (
            <path className="s-trail" d={`M${fx} ${fy} Q${(fx + tx) / 2} ${(fy + ty) / 2 - 160} ${tx} ${ty}`} />
          )}
          {phase === "fly" &&
            [1, 2, 3, 4, 5].map((k) => {
              const [kx, ky] = at(flyT - k * 0.035);
              return <circle key={k} className="s-spark" cx={kx} cy={ky} r={4 - k * 0.6} opacity={0.8 - k * 0.14} />;
            })}
          {phase !== "land" && (
            <g transform={`translate(${ex} ${ey})`}>
              <polygon className="s-packet" points="0,-11 11,0 0,11 -11,0" filter="url(#neon)" />
              <polygon className="s-packet-core" points="0,-4 4,0 0,4 -4,0" />
              <g transform="translate(16 -14)">
                <rect className="s-env-tag" x={0} y={-10} width={story.item.length * 7.6 + 14} height={19} rx={2} />
                <text className="s-packet-label" x={7} y={4}>{story.item}</text>
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
          <strong>ШАГ {beat + 1}/{STORY.length}</strong> {story.explain}
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
