import { useEffect, useRef, useState } from "react";
import { STORY } from "../demo";
import { useReducedMotion } from "./useReducedMotion";

// One beat: the sender works and talks, the item flies, the receiver catches it.
export const PREP_MS = 1100;
export const FLY_MS = 1700;
export const LAND_MS = 1300;
export const BEAT_MS = PREP_MS + FLY_MS + LAND_MS;

export type Phase = "prep" | "fly" | "land";

/** Drives the looping office story; both office views share it. */
export function useStoryClock() {
  const reduced = useReducedMotion();
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

  const phase: Phase = elapsed < PREP_MS ? "prep" : elapsed < PREP_MS + FLY_MS ? "fly" : "land";
  const flyT = phase === "prep" ? 0 : phase === "fly" ? (elapsed - PREP_MS) / FLY_MS : 1;
  return { reduced, beat, elapsed, phase, flyT, playing, setPlaying, jump, story: STORY[beat]! };
}

export type StoryClock = ReturnType<typeof useStoryClock>;

/** Step dots, the plain-words caption, and pause / next controls under a scene. */
export function StoryPanel({ clock }: { clock: StoryClock }) {
  const { reduced, beat, elapsed, playing, setPlaying, jump, story } = clock;
  return (
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
  );
}
