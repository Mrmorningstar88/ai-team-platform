import { useEffect, useRef, useState, type FormEvent, type PointerEvent } from "react";
import { answerSaved, getMessages, sendMessage, type ChatMessage, type Org } from "../api";
import { useReducedMotion } from "../components/useReducedMotion";

const MAX_CHARS = 4000;
/** How far left a finger slides, in px, to cancel a voice message, as in WhatsApp. */
const CANCEL_PX = 90;
/** A press shorter than this is a tap: it shows the hint instead of recording. */
const TAP_MS = 350;

// The browser's own speech recognition (Chrome, Safari, Edge); no audio is sent to our servers.
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;
const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
const SpeechApi = w.SpeechRecognition ?? w.webkitSpeechRecognition;

const THINKING = ["Читает сообщение", "Смотрит данные команды", "Пишет ответ"];

const ERROR_NOTE: Record<string, string> = {
  ceo_not_configured: "CEO ещё не подключён: сообщение сохранено, ответ придёт после подключения.",
  ceo_failed: "CEO не смог ответить. Ваше сообщение сохранено, отправьте вопрос ещё раз.",
  try_later: "Слишком много сообщений за час. Попробуйте чуть позже.",
  ceo_busy: "CEO уже отвечает на предыдущее сообщение. Обновите чат через минуту.",
  ai_budget_exhausted: "Бюджет ИИ на этот месяц закончился, поэтому CEO не отвечает. Сообщение сохранено: ответ придёт после пополнения бюджета или 1-го числа.",
};

interface Line extends ChatMessage { note?: boolean }

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function Chat({ org }: { org: Org }) {
  const reduced = useReducedMotion();
  const [lines, setLines] = useState<Line[] | null>(null);
  const [draft, setDraft] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [thinkStep, setThinkStep] = useState(0);
  const [rec, setRec] = useState<{ text: string; seconds: number; slide: number } | null>(null);
  const [hint, setHint] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const recRef = useRef<Recognition | null>(null);
  // What happens when recognition ends: send what was heard, or drop it.
  const finishRef = useRef<"send" | "cancel">("cancel");
  const heardRef = useRef("");
  const pressRef = useRef<{ x: number; at: number } | null>(null);
  const timerRef = useRef(0);

  useEffect(() => {
    let live = true;
    setLines(null);
    void (async () => {
      const r = await getMessages(org.id);
      const list = r.ok ? r.data : [];
      if (!live) return;
      setLines(list);
      // Messages written while the CEO wasn't connected get their answer as soon as the chat opens.
      if (list.at(-1)?.author !== "owner") return;
      setWaiting(true);
      const a = await answerSaved(org.id);
      if (!live) return;
      setWaiting(false);
      const reply = a.ok ? a.data.reply : null;
      if (reply) setLines((l) => [...(l ?? []), reply]);
    })();
    return () => { live = false; };
  }, [org.id]);

  // Braces matter: newer browsers return a promise from scrollIntoView, which must not become the effect's cleanup.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: reduced ? "auto" : "smooth" });
  }, [lines, waiting, reduced]);

  useEffect(() => {
    if (!waiting) return;
    setThinkStep(0);
    const t = window.setInterval(() => setThinkStep((s) => Math.min(s + 1, THINKING.length - 1)), 1600);
    return () => window.clearInterval(t);
  }, [waiting]);

  useEffect(() => () => { recRef.current?.abort(); window.clearInterval(timerRef.current); }, []);

  async function send(text: string) {
    const body = text.trim().slice(0, MAX_CHARS);
    if (!body || waiting) return;
    setLines((l) => [...(l ?? []), { id: `local-${Date.now()}`, author: "owner", body }]);
    setDraft("");
    setWaiting(true);
    const r = await sendMessage(org.id, body);
    setWaiting(false);
    const note = (code: string) => ({ id: `note-${Date.now()}`, author: "ceo" as const, body: ERROR_NOTE[code] ?? ERROR_NOTE.ceo_failed!, note: true });
    if (!r.ok) return setLines((l) => [...(l ?? []), note(r.error)]);
    const reply = r.data.reply;
    setLines((l) => [...(l ?? []), reply ?? note(r.data.error ?? "ceo_failed")]);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void send(draft);
  }

  function startRecording(e: PointerEvent<HTMLButtonElement>) {
    if (!SpeechApi || waiting) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pressRef.current = { x: e.clientX, at: Date.now() };
    setHint(false);
    heardRef.current = "";
    finishRef.current = "cancel";
    const r = new SpeechApi();
    r.lang = "ru-RU";
    r.interimResults = true;
    r.continuous = true;
    r.onresult = (ev) => {
      let text = "";
      for (let i = 0; i < ev.results.length; i++) text += ev.results[i]![0]!.transcript;
      heardRef.current = text;
      setRec((s) => (s ? { ...s, text } : s));
    };
    // Fires once, after stop() or abort(): the only place a voice message is sent, so it can't go twice.
    r.onend = () => {
      window.clearInterval(timerRef.current);
      recRef.current = null;
      setRec(null);
      if (finishRef.current === "send") void send(heardRef.current);
    };
    r.onerror = () => { finishRef.current = "cancel"; };
    recRef.current = r;
    r.start();
    setRec({ text: "", seconds: 0, slide: 0 });
    timerRef.current = window.setInterval(() => setRec((s) => (s ? { ...s, seconds: s.seconds + 1 } : s)), 1000);
  }

  function moveRecording(e: PointerEvent<HTMLButtonElement>) {
    const press = pressRef.current;
    if (!press || !recRef.current) return;
    const slide = Math.min(0, e.clientX - press.x);
    if (slide <= -CANCEL_PX) {
      pressRef.current = null;
      finishRef.current = "cancel";
      recRef.current.abort();
      return;
    }
    setRec((s) => (s ? { ...s, slide } : s));
  }

  function stopRecording() {
    const press = pressRef.current;
    pressRef.current = null;
    if (!press || !recRef.current) return;
    if (Date.now() - press.at < TAP_MS) {
      // A tap, not a hold: nothing was said yet, so explain how it works.
      finishRef.current = "cancel";
      recRef.current.abort();
      setHint(true);
      return;
    }
    finishRef.current = "send";
    recRef.current.stop();
  }

  const showMic = SpeechApi && !draft.trim();

  return (
    <div className="chat-screen">
      <header className="page-head">
        <h1>Чат с CEO</h1>
        <p className="muted">CEO отвечает по данным вашей команды. Можно писать или держать 🎤 и говорить.</p>
      </header>

      <div className="chat" aria-live="polite">
        {lines === null && <span className="typing" aria-label="Загрузка"><i /><i /><i /></span>}
        {lines?.length === 0 && (
          <div className="chat-empty">
            <span aria-hidden>🧭</span>
            <p>Спросите CEO, что сейчас происходит в проекте, какой план и где затыки.</p>
          </div>
        )}
        {lines?.map((m) => (
          <div key={m.id} className={`bubble ${m.author} ${m.note ? "note" : ""}`}>{m.body}</div>
        ))}
        {waiting && (
          <div className="bubble ceo thinking" aria-label="CEO думает">
            <span className="typing"><i /><i /><i /></span>
            <ol className="think-steps">
              {THINKING.map((s, i) => (
                <li key={s} className={i < thinkStep ? "done" : i === thinkStep ? "now" : ""}>{s}</li>
              ))}
            </ol>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form className={`composer ${rec ? "recording" : ""}`} onSubmit={submit}>
        {rec ? (
          <div className="rec-bar" aria-live="polite">
            <span className="rec-dot" aria-hidden />
            <span className="rec-time">{clock(rec.seconds)}</span>
            <span className="rec-text">{rec.text || "Говорите…"}</span>
            <span className="rec-cancel" style={{ transform: `translateX(${rec.slide}px)`, opacity: 1 + rec.slide / CANCEL_PX }}>‹ Влево — отмена</span>
          </div>
        ) : (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(draft); }
            }}
            rows={1}
            maxLength={MAX_CHARS}
            placeholder={hint ? "Удерживайте 🎤, чтобы записать" : "Сообщение CEO"}
            aria-label="Сообщение CEO"
          />
        )}
        {showMic || rec ? (
          <button
            type="button"
            className={`composer-btn mic ${rec ? "on" : ""}`}
            aria-label="Удерживайте, чтобы записать голосовое"
            onPointerDown={startRecording}
            onPointerMove={moveRecording}
            onPointerUp={stopRecording}
            onPointerCancel={stopRecording}
            onContextMenu={(e) => e.preventDefault()}
          >
            🎤
          </button>
        ) : (
          <button type="submit" className="composer-btn send" aria-label="Отправить" disabled={!draft.trim() || waiting}>
            ➤
          </button>
        )}
      </form>
    </div>
  );
}
