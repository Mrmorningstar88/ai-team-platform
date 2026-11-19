import { describe, expect, it } from "vitest";
import { costMicros } from "../src/worker/ceo";

describe("costMicros", () => {
  it("prices a call by the model that answered, cache included", () => {
    // Opus 5.5: $4 in, $20 out per million tokens.
    expect(costMicros("claude-opus-5-5", { input_tokens: 1000, output_tokens: 500 })).toBe(14_000);
    expect(costMicros("claude-opus-5-5", { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1000, cache_read_input_tokens: 1000 })).toBeCloseTo(5_400);
    // A fallback model the table doesn't know counts at the dearest price, never for free.
    expect(costMicros("some-new-model", { input_tokens: 1000, output_tokens: 0 })).toBe(10_000);
  });
});
