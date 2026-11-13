import { describe, expect, it } from "vitest";
import { keyFor, modelFor, parseDecision, parseInput, readAgentOutput, redact, route } from "../scripts/ai-team";

describe("AI team router", () => {
  it("follows Arut's split: Claude manages, Perplexity searches, Grok trades, OpenAI draws", () => {
    expect(route("manage")).toBe("claude");
    expect(route("search")).toBe("perplexity");
    expect(route("trading")).toBe("grok");
    expect(route("image")).toBe("openai");
    expect(route("decide")).toBe("typesafe");
  });

  it("reads the Grok key under the misspelled name too", () => {
    expect(keyFor("grok", { XAI_API_KE: "xai-abc" })).toBe("xai-abc");
    expect(keyFor("grok", { XAI_API_KEY: "xai-new", XAI_API_KE: "xai-old" })).toBe("xai-new");
    expect(keyFor("grok", { XAI_API_KEY: "  ", XAI_API_KE: "xai-old" })).toBe("xai-old");
    expect(keyFor("claude", { OPENAI_API_KEY: "x" })).toBeUndefined();
  });

  it("validates workflow input", () => {
    expect(parseInput({ TASK: "trading", PROVIDER: "auto", PROMPT: "bot idea" })).toEqual({
      task: "trading",
      provider: "grok",
      prompt: "bot idea",
    });
    expect(parseInput({ TASK: "search", PROVIDER: "openai", PROMPT: "q" }).provider).toBe("openai");
    expect(() => parseInput({ TASK: "hack", PROMPT: "q" })).toThrow(/Unknown task/);
    expect(() => parseInput({ TASK: "search", PROVIDER: "evil", PROMPT: "q" })).toThrow(/Unknown provider/);
    expect(() => parseInput({ TASK: "search", PROMPT: "  " })).toThrow(/empty/);
    expect(() => parseInput({ TASK: "search", PROMPT: "x".repeat(20_001) })).toThrow(/longer/);
  });

  it("lets repo variables override models", () => {
    expect(modelFor("perplexity", {})).toBe("fast");
    expect(modelFor("perplexity", { PERPLEXITY_EFFORT: "high" })).toBe("high");
    expect(modelFor("grok", { XAI_MODEL: "grok-4-fast" })).toBe("grok-4-fast");
  });

  it("never prints a key", () => {
    const env = { OPENAI_API_KEY: "sk-secretsecret123", XAI_API_KE: "xai-anothersecret99" };
    const out = redact("bad key sk-secretsecret123 and xai-anothersecret99 and pplx-zzzzzzzzzzzz", env);
    expect(out).not.toMatch(/secret|zzzz/);
  });

  it("reads Perplexity Agent API answers with sources", () => {
    const out = readAgentOutput({
      output: [
        { type: "search_results", results: [{ url: "https://a.com" }, { url: "https://a.com" }, { url: 5 }] },
        { type: "message", content: [{ type: "output_text", text: "BTC up" }] },
      ],
    });
    expect(out).toBe("BTC up\n\nИсточники:\n- https://a.com");
    expect(readAgentOutput({})).toBe("");
  });

  it("accepts only well-formed TypeSafe decisions", () => {
    const ok = JSON.stringify({ state: "BTC +5%", questions: { bull: { type: "noul", instructions: "Bullish" } } });
    expect(parseDecision(ok).questions).toHaveProperty("bull");
    expect(() => parseDecision("is it bullish?")).toThrow(/needs JSON/);
    expect(() => parseDecision(JSON.stringify({ questions: {} }))).toThrow(/state/);
    expect(() => parseDecision(JSON.stringify({ state: "x", questions: {} }))).toThrow(/1 to 100/);
    expect(() =>
      parseDecision(JSON.stringify({ state: "x", questions: { a: { type: "essay", instructions: "y" } } })),
    ).toThrow(/type must be/);
  });
});
