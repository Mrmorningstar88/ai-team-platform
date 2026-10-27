import { useState, type FormEvent } from "react";
import type { ProcessStep } from "../../shared/roles";
import { errorText, forgotPassword, login, resetPassword, signup, type Me } from "../api";
import { ProcessFlow } from "../components/ProcessFlow";

const SIGNUP_STEPS: ProcessStep[] = [
  { icon: "👤", title: "Аккаунт", explain: "Сохраняем вашу почту и пароль. Пароль хранится только в зашифрованном виде, его не видит даже администратор." },
  { icon: "🏢", title: "Организация", explain: "Создаём вашу организацию. Её данные видны только её участникам." },
  { icon: "🧑‍💼", title: "Команда", explain: "Нанимаем стартовую команду: CEO, техлид, тестировщик, SEO, контент и аналитик." },
  { icon: "✅", title: "Офис открыт", explain: "Вы входите в офис. Дальше вы говорите с CEO, а он ставит задачи команде." },
];

const RESET_STEPS: ProcessStep[] = [
  { icon: "✉️", title: "Письмо", explain: "Вы вводите почту, и мы отправляем на неё письмо со ссылкой." },
  { icon: "🔗", title: "Ссылка", explain: "Ссылка одноразовая и действует 1 час. Никто другой её не получит." },
  { icon: "🔑", title: "Новый пароль", explain: "По ссылке вы задаёте новый пароль. Старый перестаёт работать." },
  { icon: "✅", title: "Вход", explain: "Сразу после этого вы в офисе своей команды." },
];

type Mode = "login" | "signup" | "forgot" | "reset";

const INTRO: Record<Mode, string> = {
  signup: "Создайте организацию, и команда AI-сотрудников начнёт работать на вашу цель.",
  login: "Войдите, чтобы открыть офис своей команды.",
  forgot: "Введите почту аккаунта. Мы пришлём ссылку, чтобы задать новый пароль.",
  reset: "Придумайте новый пароль. После сохранения вы сразу войдёте.",
};

const SUBMIT: Record<Mode, [idle: string, busy: string]> = {
  signup: ["Создать команду", "Создаём команду…"],
  login: ["Войти", "Входим…"],
  forgot: ["Отправить ссылку", "Отправляем…"],
  reset: ["Сохранить пароль", "Сохраняем…"],
};

interface Props {
  onSignedIn: (me: Me) => void;
  notice?: string;
  /** Token from a reset link (#reset=…), when the page was opened from the email. */
  resetToken?: string;
}

export function Auth({ onSignedIn, notice, resetToken }: Props) {
  const [mode, setMode] = useState<Mode>(resetToken ? "reset" : "signup");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(notice ?? "");
  const [sentTo, setSentTo] = useState("");

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const get = (k: string) => String(f.get(k) ?? "");
    setBusy(true);
    setError("");
    if (mode === "forgot") {
      const r = await forgotPassword(get("email"));
      setBusy(false);
      if (r.ok) setSentTo(get("email"));
      else setError(errorText(r.error));
      return;
    }
    const r =
      mode === "login" ? await login(get("email"), get("password"))
      : mode === "reset" ? await resetPassword(resetToken ?? "", get("password"))
      : await signup({ name: get("name"), email: get("email"), password: get("password"), orgName: get("orgName") });
    setBusy(false);
    if (!r.ok) return setError(errorText(r.error));
    if (mode === "reset") history.replaceState(null, "", window.location.pathname);
    onSignedIn(r.data);
  }

  function switchTo(m: Mode) {
    setMode(m);
    setError("");
    setSentTo("");
  }

  const needsName = mode === "signup";
  const needsEmail = mode !== "reset";
  const needsPassword = mode !== "forgot";
  const newPassword = mode === "signup" || mode === "reset";

  return (
    <div className="auth">
      <div className="auth-card card">
        <div className="auth-brand">
          <span className="nav-brand-mark" aria-hidden>◎</span>
          <h1>AI-команда</h1>
        </div>
        <p className="muted">{INTRO[mode]}</p>

        {(mode === "signup" || mode === "login") && (
          <div className="segmented" role="tablist" aria-label="Вход или регистрация">
            <button type="button" role="tab" aria-selected={mode === "signup"} onClick={() => switchTo("signup")}>Регистрация</button>
            <button type="button" role="tab" aria-selected={mode === "login"} onClick={() => switchTo("login")}>Вход</button>
          </div>
        )}

        {sentTo ? (
          <div className="auth-form" role="status">
            <p>✉️ Если на <strong>{sentTo}</strong> есть аккаунт, письмо со ссылкой уже в пути. Проверьте и папку «Спам».</p>
            <button type="button" className="btn btn-secondary" onClick={() => switchTo("login")}>Вернуться ко входу</button>
          </div>
        ) : (
          // Keyed by mode so the form animates in when switched.
          <form className="auth-form" key={mode} onSubmit={submit}>
            {needsName && (
              <label className="field">
                <span>Как вас зовут</span>
                <input name="name" autoComplete="name" required maxLength={80} />
              </label>
            )}
            {needsEmail && (
              <label className="field">
                <span>Почта</span>
                <input name="email" type="email" autoComplete="email" inputMode="email" required maxLength={254} />
              </label>
            )}
            {needsPassword && (
              <label className="field">
                <span>{mode === "reset" ? "Новый пароль" : "Пароль"}</span>
                <input
                  name="password"
                  type="password"
                  autoComplete={newPassword ? "new-password" : "current-password"}
                  required
                  minLength={newPassword ? 8 : undefined}
                  maxLength={128}
                />
                {newPassword && <small className="muted">Не меньше 8 символов</small>}
              </label>
            )}
            {mode === "signup" && (
              <label className="field">
                <span>Название организации или проекта</span>
                <input name="orgName" autoComplete="organization" required maxLength={80} />
              </label>
            )}

            {error && <p className="auth-error" role="alert">{error}</p>}

            <button type="submit" className="btn btn-primary" disabled={busy}>
              {SUBMIT[mode][busy ? 1 : 0]}
            </button>
            {mode === "login" && (
              <button type="button" className="btn btn-plain" onClick={() => switchTo("forgot")}>Забыли пароль?</button>
            )}
            {(mode === "forgot" || mode === "reset") && (
              <button type="button" className="btn btn-plain" onClick={() => switchTo("login")}>Вернуться ко входу</button>
            )}
          </form>
        )}
      </div>

      {mode === "signup" && (
        <section className="card auth-explain" aria-labelledby="auth-explain-title">
          <h2 id="auth-explain-title">Что произойдёт после регистрации</h2>
          <ProcessFlow steps={SIGNUP_STEPS} label="Шаги регистрации" />
        </section>
      )}
      {mode === "forgot" && (
        <section className="card auth-explain" aria-labelledby="auth-explain-title">
          <h2 id="auth-explain-title">Как работает восстановление</h2>
          <ProcessFlow steps={RESET_STEPS} label="Шаги восстановления пароля" />
        </section>
      )}
    </div>
  );
}
