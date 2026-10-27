// Thin client for the accounts API. Every response is checked at runtime,
// since the server (or a proxy in front of it) may answer with anything.

export interface Me {
  user: { id: string; email: string; name: string };
  orgs: { id: string; name: string; role: string }[];
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

function isMe(v: unknown): v is Me {
  if (typeof v !== "object" || v === null) return false;
  const m = v as Record<string, unknown>;
  const user = m.user as Record<string, unknown> | undefined;
  return (
    typeof user === "object" && user !== null &&
    typeof user.id === "string" && typeof user.email === "string" && typeof user.name === "string" &&
    Array.isArray(m.orgs) &&
    m.orgs.every((o) => typeof o === "object" && o !== null && typeof o.id === "string" && typeof o.name === "string")
  );
}

async function call(method: "GET" | "POST", path: string, body?: object): Promise<ApiResult<unknown>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    return { ok: false, status: 0, error: "network" };
  }
  const data: unknown = await res.json().catch(() => null);
  if (res.ok) return { ok: true, data };
  const error = typeof data === "object" && data !== null && typeof (data as { error?: unknown }).error === "string"
    ? (data as { error: string }).error
    : "server";
  return { ok: false, status: res.status, error };
}

async function callMe(method: "GET" | "POST", path: string, body?: object): Promise<ApiResult<Me>> {
  const r = await call(method, path, body);
  if (!r.ok) return r;
  return isMe(r.data) ? { ok: true, data: r.data } : { ok: false, status: 500, error: "server" };
}

export const getMe = () => callMe("GET", "/api/me");

export const login = (email: string, password: string) => callMe("POST", "/api/auth/login", { email, password });

export const signup = (input: { name: string; email: string; password: string; orgName: string }) =>
  callMe("POST", "/api/auth/signup", input);

export const logout = () => call("POST", "/api/auth/logout", {});

/** Russian text for every error code the accounts API can return. */
export const ERROR_TEXT: Record<string, string> = {
  invalid_email: "Проверьте почту: похоже, в адресе ошибка.",
  weak_password: "Пароль нужен от 8 до 128 символов.",
  invalid_name: "Напишите, как вас зовут (до 80 символов).",
  invalid_org_name: "Назовите организацию (до 80 символов).",
  email_taken: "На эту почту уже есть аккаунт. Войдите или используйте другую почту.",
  invalid_credentials: "Почта или пароль не подходят.",
  too_many_attempts: "Слишком много попыток. Подождите 15 минут и попробуйте снова.",
  no_database: "Сервер ещё не подключён к базе данных. Владельцу нужно добавить базу D1 в настройках Cloudflare.",
  network: "Нет связи с сервером. Проверьте интернет и попробуйте снова.",
};

export const errorText = (code: string) => ERROR_TEXT[code] ?? "Что-то пошло не так. Попробуйте ещё раз.";
