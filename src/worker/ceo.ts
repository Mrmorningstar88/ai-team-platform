import Anthropic from "@anthropic-ai/sdk";

/** One turn of the owner's chat with the CEO, oldest first. */
export interface ChatTurn { author: "owner" | "ceo"; body: string }

/** Asks the CEO for its next reply; null when the model gave no usable answer. */
export type AskCeo = (system: string, history: ChatTurn[]) => Promise<string | null>;

export const CEO_MODEL = "claude-opus-5-5";
const MAX_REPLY_TOKENS = 4000;

export interface CeoContext {
  project: string;
  goal: string;
  /** The team's latest reported state as JSON (agents, reports, tasks), or null when no team reports yet. */
  team: unknown;
}

/**
 * The CEO's brief. Stable text first, the project's live data last, so the
 * team snapshot is the only part that changes between replies.
 */
export function ceoSystem(ctx: CeoContext): string {
  return [
    "Ты CEO ИИ-команды в сервисе Tamania. Владелец проекта пишет тебе в чат, обычно по-русски, часто голосом, поэтому в тексте бывают ошибки распознавания: понимай смысл.",
    "Отвечай как живой руководитель: коротко, по делу, простыми словами, без канцелярита и без markdown-таблиц. Сначала главное, потом детали. Обычно 3–8 предложений или короткий список.",
    "Опирайся только на данные команды ниже: статусы сотрудников, их последние запуски, отчёты, задачи и прогресс к цели (progress: value из target; value null — ещё не измеряется). Не выдумывай цифры, которых там нет. Если данных не хватает, прямо скажи, чего не хватает и кто из команды может это добыть.",
    "Когда тебя спрашивают о плане, предложи конкретные шаги к цели проекта: что делаем на этой неделе, кто отвечает, как поймём, что сработало. Называй затыки честно: ошибки ботов, нехватку доступов, задачи, которые долго висят.",
    "Ты пока не можешь сам запускать сотрудников или менять сайт из этого чата. Если владелец просит что-то сделать, скажи, кто из команды это сделает и что нужно от владельца (например, нажать Merge или дать доступ).",
    "",
    `Проект: ${ctx.project}`,
    `Цель: ${ctx.goal || "не задана; спроси владельца о цели, если это важно для ответа"}`,
    `Сегодня: ${new Date().toISOString().slice(0, 10)}`,
    "",
    "Данные команды (JSON, обновляются раз в час):",
    ctx.team ? JSON.stringify(ctx.team) : "Команда ещё не подключена: данных о сотрудниках нет.",
  ].join("\n");
}

/** A CEO backed by the Claude API. */
export function claudeCeo(apiKey: string): AskCeo {
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 60_000 });
  return async (system, history) => {
    const response = await client.beta.messages.create({
      model: CEO_MODEL,
      max_tokens: MAX_REPLY_TOKENS,
      // Chat answers don't need deep reasoning; low effort keeps replies fast and cheap.
      output_config: { effort: "low" },
      // A declined request is retried on another model instead of leaving the owner without an answer.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system,
      messages: history.map((t) => ({ role: t.author === "owner" ? "user" : "assistant", content: t.body })),
    });
    if (response.stop_reason === "refusal") return null;
    const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
    return text || null;
  };
}
