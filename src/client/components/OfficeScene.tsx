import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "./useReducedMotion";

// Isometric projection: one floor tile is 64×32 px on screen.
const TW = 32;
const TH = 16;

// One beat: the sender works and talks, the item flies, the receiver catches it.
const PREP_MS = 1100;
const FLY_MS = 1700;
const LAND_MS = 1300;
const BEAT_MS = PREP_MS + FLY_MS + LAND_MS;

/** How a person looks right now: typing, done, stuck, free, or a desk still being filled. */
export type SceneMode = "working" | "waiting" | "done" | "error" | "idle" | "planned";

export interface ScenePerson {
  id: string;
  name: string;
  icon: string;
  color: string;
  mode: SceneMode;
  /** Read by screen readers and shown when the person is picked. */
  label: string;
}

/** One step of the office's story. `to` may be a person's id, "owner" or "site". */
export interface SceneBeat {
  from: string;
  to: string;
  /** What travels, shown on the envelope's tag. */
  item: string;
  /** What the sender says while it works. */
  says: string;
  /** Plain explanation shown under the office. */
  explain: string;
}

type Pt = [number, number];
const iso = (x: number, y: number): Pt => [(x - y) * TW, (x + y) * TH];
const pts = (a: Pt[]) => a.map((p) => p.join(",")).join(" ");
const up = (p: Pt, h: number): Pt => [p[0], p[1] - h];
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

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

interface Props {
  people: ScenePerson[];
  beats: SceneBeat[];
  goal: string;
  onPick: (id: string) => void;
  label?: string;
}

/** A desk with its person, drawn in its own small isometric tile. */
function DeskArt({ person, mode }: { person: ScenePerson; mode: SceneMode | "busy" | "catch" }) {
  const [px, py] = iso(0.8, 1.5);
  const [mx, my] = iso(0.8, 0.4);
  const screenOn = mode === "working" || mode === "busy" || mode === "catch" || mode === "waiting";
  return (
    <svg className="tile-art" viewBox="-36 -34 92 84" aria-hidden>
      <polygon className="s-floor" points={pts([iso(-0.6, -0.4), iso(2.2, -0.4), iso(2.2, 2.4), iso(-0.6, 2.4)])} />
      {box(0, 0, 1.6, 0.8, 14, ["s-desk-top", "s-desk-l", "s-desk-r"])}
      <rect className="s-screen" x={mx - 13} y={my - 38} width={26} height={18} rx={2} />
      {screenOn && <rect className="s-screen-on" x={mx - 11} y={my - 36} width={22} height={14} rx={1} />}
      {screenOn && (
        <g className="s-code">
          <rect x={mx - 9} y={my - 34} width={12} height={2} rx={1} />
          <rect x={mx - 9} y={my - 30} width={16} height={2} rx={1} />
          <rect x={mx - 9} y={my - 26} width={9} height={2} rx={1} />
        </g>
      )}
      <ellipse className="s-chair" cx={px} cy={py} rx={12} ry={6} />
      {mode !== "planned" && (
        <g className="s-body">
          <rect x={px - 8} y={py - 24} width={16} height={20} rx={7} fill={person.color} />
          <circle className="s-skin" cx={px} cy={py - 31} r={7.5} />
          <rect className="s-skin s-arm-l" x={px - 12} y={py - 20} width={4} height={11} rx={2} />
          <rect className="s-skin s-arm-r" x={px + 8} y={py - 20} width={4} height={11} rx={2} />
        </g>
      )}
      {mode === "catch" && <circle className="s-ring" cx={px} cy={py - 18} r={22} />}
    </svg>
  );
}

const BADGE: Partial<Record<SceneMode, string>> = { error: "!", done: "✓", working: "⌨", waiting: "…" };

/**
 * A living office: everyone sits at their desk, and a story loops on top of it.
 * Each beat, one person works and says what they are doing, then the item
 * flies to where it goes, and the caption explains the step in plain words.
 * Desks are tiles in a grid, so the office fits a phone without shrinking people.
 */
export function OfficeScene({ people, beats, goal, onPick, label = "Офис команды" }: Props) {
  const reduced = useReducedMotion();
  const [beat, setBeat] = useState(0);
  const [elapsed, setElapsed] = useState(reduced ? BEAT_MS : 0);
  const [playing, setPlaying] = useState(true);
  const [spots, setSpots] = useState<Record<string, Pt>>({});
  const startRef = useRef(0);
  const floorRef = useRef<HTMLDivElement>(null);
  const hasStory = beats.length > 0;

  // Where each tile's person sits on the floor, re-measured when the layout changes.
  useEffect(() => {
    const floor = floorRef.current;
    if (!floor) return;
    const measure = () => {
      const base = floor.getBoundingClientRect();
      const next: Record<string, Pt> = {};
      floor.querySelectorAll<HTMLElement>("[data-spot]").forEach((el) => {
        const r = el.getBoundingClientRect();
        next[el.dataset.spot!] = [r.left - base.left + r.width / 2, r.top - base.top + r.height * 0.35];
      });
      setSpots(next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(floor);
    return () => ro.disconnect();
  }, [people.length]);

  useEffect(() => {
    if (reduced || !playing || !hasStory) return;
    let frame = 0;
    startRef.current = performance.now() - elapsed;
    const tick = (now: number) => {
      const t = now - startRef.current;
      if (t >= BEAT_MS) {
        setBeat((b) => (b + 1) % beats.length);
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
  }, [reduced, playing, hasStory, beats.length]);

  function jump(i: number) {
    setBeat(i);
    setElapsed(reduced ? BEAT_MS : 0);
    startRef.current = performance.now();
  }

  const story = hasStory ? beats[beat % beats.length]! : null;
  const phase = elapsed < PREP_MS ? "prep" : elapsed < PREP_MS + FLY_MS ? "fly" : "land";
  const flyT = phase === "prep" ? 0 : phase === "fly" ? (elapsed - PREP_MS) / FLY_MS : 1;
  const ease = flyT < 0.5 ? 2 * flyT * flyT : 1 - (-2 * flyT + 2) ** 2 / 2;
  const from = story ? spots[story.from] : undefined;
  const to = story ? spots[story.to] : undefined;
  const flying = story && from && to && phase !== "land" ? {
    x: from[0] + (to[0] - from[0]) * ease,
    y: from[1] + (to[1] - from[1]) * ease - Math.sin(Math.PI * ease) * 60,
  } : null;

  const modeOf = (id: string, base: SceneMode) => {
    if (story && id === story.from && phase !== "land") return "busy" as const;
    if (story && id === story.to && phase === "land") return "catch" as const;
    return base;
  };
  const speech = (id: string) => {
    if (!story) return null;
    if (id === story.from && phase !== "land") return <span className="tile-bubble">{clip(story.says, 40)}</span>;
    if (id === story.to && phase === "land") return <span className="tile-bubble got">Принято ✓</span>;
    return null;
  };

  return (
    <section className="office-scene card" aria-label={label}>
      {goal && <div className="office-goal"><span aria-hidden>🎯</span> {goal}</div>}
      <div className="office-floor" ref={floorRef}>
        {people.map((p) => {
          const mode = modeOf(p.id, p.mode);
          return (
            <button key={p.id} type="button" className={`desk-tile person m-${mode}`} data-spot={p.id} onClick={() => onPick(p.id)} aria-label={`${p.name}: ${p.label}`}>
              {speech(p.id)}
              {BADGE[p.mode] && <span className={`tile-badge b-${p.mode}`} aria-hidden>{BADGE[p.mode]}</span>}
              <DeskArt person={p} mode={mode} />
              <span className="tile-name"><span aria-hidden>{p.icon}</span> {p.name}</span>
              {p.mode === "planned" && <span className="tile-sub">Нанимается</span>}
            </button>
          );
        })}
        <div className={`desk-tile fixed-tile ${story?.to === "site" && phase === "land" ? "glow" : ""}`} data-spot="site">
          {speech("site")}
          <span className="fixed-icon" aria-hidden>🌐</span>
          <span className="tile-name">Сайт</span>
        </div>
        <div className={`desk-tile fixed-tile owner-tile ${story?.to === "owner" && phase === "land" ? "glow" : ""}`} data-spot="owner">
          {speech("owner")}
          <span className="fixed-icon" aria-hidden>👤</span>
          <span className="tile-name">Вы</span>
        </div>
        {story && flying && (
          <>
            {phase === "fly" && from && to && (
              <svg className="tile-trail" aria-hidden>
                <path d={`M${from[0]} ${from[1]} Q${(from[0] + to[0]) / 2} ${(from[1] + to[1]) / 2 - 120} ${to[0]} ${to[1]}`} />
              </svg>
            )}
            <div className="tile-envelope" style={{ transform: `translate(${flying.x}px, ${flying.y}px)` }} aria-hidden>
              <span>✉️</span><span className="tile-envelope-tag">{clip(story.item, 22)}</span>
            </div>
          </>
        )}
      </div>

      {story && (
        <div className="story">
          <div className="story-dots" role="tablist" aria-label="Шаги">
            {beats.map((s, i) => (
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
            <strong>{beat + 1} из {beats.length}.</strong> {story.explain}
          </div>
          <div className="flow-controls">
            {!reduced && (
              <button type="button" className="btn btn-plain" onClick={() => setPlaying((p) => !p)}>
                {playing ? "Пауза" : "Смотреть"}
              </button>
            )}
            <button type="button" className="btn btn-plain" onClick={() => jump((beat + 1) % beats.length)}>
              Дальше →
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
