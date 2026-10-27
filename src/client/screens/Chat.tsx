import { useEffect, useRef, useState, type FormEvent } from "react";
import { roleById } from "../../shared/roles";
import { useReducedMotion } from "../components/useReducedMotion";
import { DEMO_AGENTS, type DemoMessage } from "../demo";

const MAX_CHARS = 4000;
const READ_MS = 900;
const DELEGATE_MS = 2200;

interface ChatMessage extends DemoMessage {
  delegated?: string[];
}

// Demo routing only: the real CEO agent decides who gets the task.
const ROUTES: [RegExp, string[]][] = [
  [/цифр|отч[её]т|клик|переход|деньг|доход/i, ["a6"]],
  [/ошибк|баг|слом|не работает|упал/i, ["a3", "a2"]],
  [/текст|стать|контент|пост/i, ["a5"]],
  [/сайт|страниц|заголов|google|гугл|seo|индекс/i, ["a4", "a2"]],
];

function routeFor(text: string): string[] {
  return ROUTES.find(([re]) => re.test(text))?.[1] ?? ["a4", "a6"];
}

const nameOf = (id: string) => DEMO_AGENTS.find((a) => a.id === id)?.name ?? id;
const iconOf = (id: string) => roleById(DEMO_AGENTS.find((a) => a.id === id)?.role ?? "")?.icon ?? "🤖";

// The browser's own speech recognition (Chrome, Safari, Edge); no audio leaves for our servers.
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
const SpeechApi = (window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition })
  .SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition;

function DelegationStrip({ to }: { to: string[] }) {
  return (
    <div className="delegate" aria-label={`CEO передаёт задачу: ${to.map(nameOf).join(", ")}`}>
      <span className="delegate-who ceo"><span aria-hidden>🧭</span>CEO</span>
      <span className="delegate-track" aria-hidden>
        <span className="delegate-token">📋</span>
      </span>
      <span className="delegate-team">
        {to.map((id, i) => (
          <span key={id} className="delegate-who" style={{ animationDelay: `${900 + i * 250}ms` }}>
            <span aria-hidden>{iconOf(id)}</span>{nameOf(id)}
          </span>
        ))}
      </span>
      <p className="muted small delegate-caption">CEO разбирает ваше сообщение и передаёт задачу тем, кто её сделает.</p>
    </div>
  );
}

export function Chat() {
  const reduced = useReducedMotion();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [phase, setPhase] = useState<"idle" | "reading" | "delegating">("idle");
  const [route, setRoute] = useState<string[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  const [listening, setListening] = useState(false);
  const recRef = useRef<Recognition | null>(null);

  function toggleVoice() {
    if (listening) return recRef.current?.stop();
    if (!SpeechApi) return;
    const rec = new SpeechApi();
    rec.lang = "ru-RU";
    rec.interimResults = true;
    rec.continuous = true;
    const before = draft.trim() ? `${draft.trim()} ` : "";
    rec.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i]![0]!.transcript;
      setDraft((before + text).slice(0, MAX_CHARS));
    };
    rec.onend = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  }

  useEffect(() => () => recRef.current?.stop(), []);

  // Braces matter: newer browsers return a promise from scrollIntoView, which must not become the effect's cleanup.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: reduced ? "auto" : "smooth" });
  }, [messages, phase, reduced]);

  function send(e: FormEvent) {
    e.preventDefault();
    recRef.current?.stop();
    const body = draft.trim();
    if (!body || phase !== "idle") return;
    const to = routeFor(body);
    setMessages((m) => [...m, { author: "owner", body }]);
    setDraft("");
    setRoute(to);
    setPhase("reading");
    window.setTimeout(() => setPhase("delegating"), READ_MS);
    window.setTimeout(() => {
      setMessages((m) => [
        ...m,
        { author: "ceo", body: "Это пример: так CEO будет передавать задачи. Настоящий CEO ещё не подключён, поэтому задача никуда не ушла.", delegated: to },
      ]);
      setPhase("idle");
    }, READ_MS + DELEGATE_MS);
  }

  return (
    <>
      <header className="page-head">
        <h1>Чат с CEO</h1>
        <p className="muted">Пишите как руководителю. Вы увидите, кому CEO передаёт вашу задачу.</p>
        <p className="pill" style={{ marginTop: 8 }}>Пример: настоящий CEO подключается следующим шагом</p>
      </header>
      <div className="chat" aria-live="polite">
        {messages.map((m, i) => (
          <div key={i} className={`bubble ${m.author}`}>
            {m.body}
            {m.delegated && (
              <div className="chips">
                {m.delegated.map((id) => (
                  <span key={id} className="pill"><span aria-hidden>{iconOf(id)}</span>{nameOf(id)} взял задачу</span>
                ))}
              </div>
            )}
          </div>
        ))}
        {phase === "reading" && (
          <div className="bubble" aria-label="CEO читает">
            <span className="typing"><i /><i /><i /></span>
          </div>
        )}
        {phase === "delegating" && <DelegationStrip to={route} />}
        <div ref={endRef} />
      </div>
      <form className="composer" onSubmit={send}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={MAX_CHARS}
          placeholder="Например: почему упали переходы?"
          aria-label="Сообщение CEO"
        />
        {SpeechApi && (
          <button
            type="button"
            className={`btn btn-secondary mic ${listening ? "on" : ""}`}
            aria-pressed={listening}
            onClick={toggleVoice}
          >
            {listening ? "■ Стоп" : "🎤 Сказать"}
          </button>
        )}
        <button type="submit" className="btn btn-primary" disabled={!draft.trim() || phase !== "idle"}>Отправить</button>
      </form>
    </>
  );
}
