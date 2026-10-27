import { useState, type FormEvent } from "react";
import { errorText, sendLead } from "../api";
import { Sheet } from "./Sheet";

const COPY = {
  access: {
    title: "Заявка на ранний доступ",
    intro: "Пока регистрация открыта по промокодам. Оставьте почту, и мы пришлём промокод, когда освободится место.",
    message: "Что хотите поручить AI-команде? (необязательно)",
    submit: "Отправить заявку",
  },
  enterprise: {
    title: "Корпоративный тариф",
    intro: "AI-колл-центр, AI-отдел продаж и настройка под ваши процессы. Расскажите о задаче, и мы свяжемся с вами.",
    message: "Задача: сколько звонков, какие продажи, какие системы",
    submit: "Запросить предложение",
  },
} as const;

export function LeadSheet({ kind, onClose }: { kind: "access" | "enterprise"; onClose: () => void }) {
  const copy = COPY[kind];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const get = (k: string) => String(f.get(k) ?? "");
    setBusy(true);
    setError("");
    const r = await sendLead({ kind, name: get("name"), email: get("email"), company: get("company"), message: get("message") });
    setBusy(false);
    if (r.ok) setDone(true);
    else setError(errorText(r.error));
  }

  return (
    <Sheet title={copy.title} onClose={onClose}>
      {done ? (
        <div className="auth-form" role="status">
          <p>✅ Заявка у нас. Ответим на почту, обычно в течение дня.</p>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Готово</button>
        </div>
      ) : (
        <form className="auth-form" onSubmit={submit}>
          <p className="muted">{copy.intro}</p>
          <label className="field">
            <span>Имя</span>
            <input name="name" autoComplete="name" required maxLength={80} />
          </label>
          <label className="field">
            <span>Почта</span>
            <input name="email" type="email" autoComplete="email" inputMode="email" required maxLength={254} />
          </label>
          <label className="field">
            <span>Компания или сайт{kind === "access" ? " (необязательно)" : ""}</span>
            <input name="company" autoComplete="organization" required={kind === "enterprise"} maxLength={120} />
          </label>
          <label className="field">
            <span>{copy.message}</span>
            <textarea name="message" rows={3} maxLength={2000} />
          </label>
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Отправляем…" : copy.submit}</button>
        </form>
      )}
    </Sheet>
  );
}
