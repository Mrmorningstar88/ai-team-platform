// AI team router. Claude manages the work and hands each piece to the model
// that is best at it: Perplexity for quick answers and web search, Grok for
// trading bots and strategies, OpenAI for images. Keys live only in GitHub
// Actions secrets, so this runs inside the "AI team" workflow.
//
// Usage (in the workflow): node scripts/ai-team.ts check
//                          node scripts/ai-team.ts ask   (TASK, PROVIDER, PROMPT from env)
// No imports beyond node builtins, so Node runs it without a build step.

import { appendFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export type Provider = "claude" | "perplexity" | "grok" | "openai";
export type Task = "manage" | "search" | "trading" | "image" | "text";

export const TASKS: readonly Task[] = ["manage", "search", "trading", "image", "text"];
export const PROVIDERS: readonly Provider[] = ["claude", "perplexity", "grok", "openai"];

// Arut's split (2026-11-13). Claude is the manager everywhere.
const ROUTES: Record<Task, Provider> = {
  manage: "claude",
  search: "perplexity",
  trading: "grok",
  image: "openai",
  text: "openai",
};

export function route(task: Task): Provider {
  return ROUTES[task];
}

type Env = Record<string, string | undefined>;

// The Grok secret was first saved as XAI_API_KE, so accept both names.
export function keyFor(provider: Provider, env: Env): string | undefined {
  const pick = (...names: string[]) => names.map((n) => env[n]?.trim()).find((v) => v);
  switch (provider) {
    case "openai":
      return pick("OPENAI_API_KEY");
    case "perplexity":
      return pick("PERPLEXITY_API_KEY");
    case "grok":
      return pick("XAI_API_KEY", "XAI_API_KE", "GROK_API_KEY");
    case "claude":
      return undefined;
  }
}

const BASE: Record<Exclude<Provider, "claude">, string> = {
  openai: "https://api.openai.com/v1",
  perplexity: "https://api.perplexity.ai",
  grok: "https://api.x.ai/v1",
};

export function modelFor(provider: Exclude<Provider, "claude">, env: Env): string {
  const defaults = { openai: "gpt-4.1-mini", perplexity: "sonar", grok: "grok-4" };
  const override = { openai: env.OPENAI_MODEL, perplexity: env.PERPLEXITY_MODEL, grok: env.XAI_MODEL };
  return override[provider]?.trim() || defaults[provider];
}

export function parseInput(env: Env): { task: Task; provider: Provider; prompt: string } {
  const task = (env.TASK ?? "text").trim() as Task;
  if (!TASKS.includes(task)) throw new Error(`Unknown task "${task}". Use one of: ${TASKS.join(", ")}`);
  const rawProvider = (env.PROVIDER ?? "auto").trim();
  if (rawProvider !== "auto" && !PROVIDERS.includes(rawProvider as Provider)) {
    throw new Error(`Unknown provider "${rawProvider}". Use auto or one of: ${PROVIDERS.join(", ")}`);
  }
  const provider = rawProvider === "auto" ? route(task) : (rawProvider as Provider);
  const prompt = (env.PROMPT ?? "").trim();
  if (!prompt) throw new Error("PROMPT is empty");
  if (prompt.length > 20_000) throw new Error("PROMPT is longer than 20000 characters");
  return { task, provider, prompt };
}

// Never let a key reach the logs, even inside an error body.
export function redact(text: string, env: Env): string {
  let out = text;
  for (const p of PROVIDERS) {
    const k = keyFor(p, env);
    if (k && k.length > 8) out = out.split(k).join("***");
  }
  return out.replace(/\b(sk|xai|pplx)-[A-Za-z0-9_-]{8,}/g, "$1-***");
}

async function call(url: string, key: string, body?: unknown): Promise<any> {
  const res = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

export async function chat(provider: Exclude<Provider, "claude">, prompt: string, env: Env): Promise<string> {
  const key = keyFor(provider, env);
  if (!key) throw new Error(`No key for ${provider}`);
  const data = await call(`${BASE[provider]}/chat/completions`, key, {
    model: modelFor(provider, env),
    messages: [{ role: "user", content: prompt }],
  });
  const answer: string = data?.choices?.[0]?.message?.content ?? "";
  const sources: string[] = Array.isArray(data?.citations) ? data.citations : [];
  return sources.length ? `${answer}\n\nИсточники:\n${sources.map((s) => `- ${s}`).join("\n")}` : answer;
}

export async function image(prompt: string, env: Env): Promise<Buffer> {
  const key = keyFor("openai", env);
  if (!key) throw new Error("No key for openai");
  const data = await call(`${BASE.openai}/images/generations`, key, {
    model: env.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-1",
    prompt,
    size: "1024x1024",
  });
  const b64: string | undefined = data?.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI returned no image");
  return Buffer.from(b64, "base64");
}

// Smallest call that proves the key works. OpenAI and xAI list models (free);
// Perplexity has no free endpoint, so it answers one short question.
export async function check(provider: Exclude<Provider, "claude">, env: Env): Promise<string> {
  const key = keyFor(provider, env);
  if (!key) return "нет ключа";
  if (provider === "perplexity") {
    await call(`${BASE.perplexity}/chat/completions`, key, {
      model: modelFor("perplexity", env),
      messages: [{ role: "user", content: "Reply with OK" }],
      max_tokens: 5,
    });
    return `работает (${modelFor("perplexity", env)})`;
  }
  const data = await call(`${BASE[provider]}/models`, key);
  const ids: string[] = (data?.data ?? []).map((m: { id: string }) => m.id);
  return `работает, моделей: ${ids.length}`;
}

function report(line: string) {
  console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, line + "\n");
}

async function main() {
  const env = process.env;
  const mode = process.argv[2] ?? "ask";
  if (mode === "check") {
    report("| ИИ | Задачи | Ключ |\n| --- | --- | --- |");
    let failed = 0;
    for (const p of ["perplexity", "grok", "openai"] as const) {
      const tasks = TASKS.filter((t) => route(t) === p).join(", ");
      const status = await check(p, env).catch((e: Error) => {
        failed++;
        return `ошибка: ${redact(e.message, env)}`;
      });
      if (status === "нет ключа") failed++;
      report(`| ${p} | ${tasks} | ${status} |`);
    }
    if (env.XAI_API_KE && !env.XAI_API_KEY) report("\nGrok key is saved as XAI_API_KE; it works, but XAI_API_KEY is the standard name.");
    process.exitCode = failed ? 1 : 0;
    return;
  }

  const { task, provider, prompt } = parseInput(env);
  if (provider === "claude") {
    report("Эту задачу ведёт Claude (управляющий). Другие ИИ не вызывались.");
    return;
  }
  if (task === "image") {
    if (provider !== "openai") throw new Error("Images are made by openai");
    writeFileSync("answer.png", await image(prompt, env));
    report(`Картинка готова: answer.png (в артефакте запуска).`);
    return;
  }
  const answer = await chat(provider, prompt, env);
  writeFileSync("answer.md", answer);
  report(`### ${provider} (${modelFor(provider, env)})\n\n${answer}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e: Error) => {
    console.error(redact(e.message, process.env));
    process.exitCode = 1;
  });
}
