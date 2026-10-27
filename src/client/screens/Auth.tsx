import { useState, type FormEvent } from "react";
import type { ProcessStep } from "../../shared/roles";
import { errorText, login, signup, type Me } from "../api";
import { ProcessFlow } from "../components/ProcessFlow";

const SIGNUP_STEPS: ProcessStep[] = [
  { icon: "👤", title: "Аккаунт", explain: "Сохраняем вашу почту и пароль. Пароль хранится только в зашифрованном виде, его не видит даже администратор." },
  { icon: "🏢", title: "Организация", explain: "Создаём вашу организацию. Её данные видны только её участникам." },
  { icon: "🧑‍💼", title: "Команда", explain: "Нанимаем стартовую команду: CEO, техлид, тестировщик, SEO, контент и аналитик." },
  { icon: "✅", title: "Офис открыт", explain: "Вы входите в офис. Дальше вы говорите с CEO, а он ставит задачи команде." },
];

type Mode = "login" | "signup";

export function Auth({ onSignedIn, notice }: { onSignedIn: (me: Me) => void; notice?: string }) {
  const [mode, setMode] = useState<Mode>("signup");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(notice ?? "");

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const get = (k: string) => String(f.get(k) ?? "");
    setBusy(true);
    setError("");
    const r = mode === "login"
      ? await login(get("email"), get("password"))
      : await signup({ name: get("name"), email: get("email"), password: get("password"), orgName: get("orgName") });
    setBusy(false);
    if (r.ok) onSignedIn(r.data);
    else setError(errorText(r.error));
  }

  function switchTo(m: Mode) {
    setMode(m);
    setError("");
  }

  return (
    <div className="auth">
      <div className="auth-card card">
        <div className="auth-brand">
          <span className="nav-brand-mark" aria-hidden>◎</span>
          <h1>AI-команда</h1>
        </div>
        <p className="muted">
          {mode === "signup" ? "Создайте организацию, и команда AI-сотрудников начнёт работать на вашу цель." : "Войдите, чтобы открыть офис своей команды."}
        </p>

        <div className="segmented" role="tablist" aria-label="Вход или регистрация">
          <button type="button" role="tab" aria-selected={mode === "signup"} onClick={() => switchTo("signup")}>Регистрация</button>
          <button type="button" role="tab" aria-selected={mode === "login"} onClick={() => switchTo("login")}>Вход</button>
        </div>

        {/* Keyed by mode so the form animates in when switched. */}
        <form className="auth-form" key={mode} onSubmit={submit}>
          {mode === "signup" && (
            <label className="field">
              <span>Как вас зовут</span>
              <input name="name" autoComplete="name" required maxLength={80} />
            </label>
          )}
          <label className="field">
            <span>Почта</span>
            <input name="email" type="email" autoComplete="email" inputMode="email" required maxLength={254} />
          </label>
          <label className="field">
            <span>Пароль</span>
            <input
              name="password"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
              minLength={mode === "signup" ? 8 : undefined}
              maxLength={128}
            />
            {mode === "signup" && <small className="muted">Не меньше 8 символов</small>}
          </label>
          {mode === "signup" && (
            <label className="field">
              <span>Название организации или проекта</span>
              <input name="orgName" autoComplete="organization" required maxLength={80} />
            </label>
          )}

          {error && <p className="auth-error" role="alert">{error}</p>}

          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? (mode === "signup" ? "Создаём команду…" : "Входим…") : mode === "signup" ? "Создать команду" : "Войти"}
          </button>
        </form>
      </div>

      {mode === "signup" && (
        <section className="card auth-explain" aria-labelledby="auth-explain-title">
          <h2 id="auth-explain-title">Что произойдёт после регистрации</h2>
          <ProcessFlow steps={SIGNUP_STEPS} label="Шаги регистрации" />
        </section>
      )}
    </div>
  );
}
