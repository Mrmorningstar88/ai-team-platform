import { useEffect, useRef, useState, type FormEvent } from "react";
import { DEMO_MESSAGES, type DemoMessage } from "../demo";

const MAX_CHARS = 4000;
const DEMO_REPLY_MS = 1400;

export function Chat() {
  const [messages, setMessages] = useState<DemoMessage[]>(DEMO_MESSAGES);
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => endRef.current?.scrollIntoView({ block: "end" }), [messages, typing]);

  function send(e: FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || typing) return;
    setMessages((m) => [...m, { author: "owner", body }]);
    setDraft("");
    setTyping(true);
    // Demo only: the real reply comes from the CEO agent through the API.
    window.setTimeout(() => {
      setMessages((m) => [...m, { author: "ceo", body: "Принял. Разберу с командой и вернусь с ответом в утреннем отчёте." }]);
      setTyping(false);
    }, DEMO_REPLY_MS);
  }

  return (
    <>
      <header className="page-head">
        <h1>Чат с CEO</h1>
        <p className="muted">Пишите как руководителю. CEO раздаст задачи команде и вернётся с результатом.</p>
      </header>
      <div className="chat" aria-live="polite">
        {messages.map((m, i) => (
          <div key={i} className={`bubble ${m.author}`}>{m.body}</div>
        ))}
        {typing && (
          <div className="bubble" aria-label="CEO печатает">
            <span className="typing"><i /><i /><i /></span>
          </div>
        )}
        <div ref={endRef} />
      </div>
      <form className="composer" onSubmit={send}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={MAX_CHARS}
          placeholder="Напишите CEO"
          aria-label="Сообщение CEO"
        />
        <button type="submit" className="btn btn-primary" disabled={!draft.trim() || typing}>Отправить</button>
      </form>
    </>
  );
}
