import { describe, expect, it } from "vitest";
import { errorFromResponse } from "./api";

describe("errorFromResponse", () => {
  it("prefers the server's JSON error text", () => {
    expect(
      errorFromResponse(400, '{"error":"id must match a-z 0-9 -"}', "/__editor/new-world").message,
    ).toBe("id must match a-z 0-9 -");
  });
  it("falls back to status plus truncated body", () => {
    const m = errorFromResponse(500, "<html>boom</html>", "/x").message;
    expect(m.startsWith("/x failed (500)")).toBe(true);
    expect(m).toContain("<html>boom</html>");
    const long = errorFromResponse(500, "a".repeat(500), "/x").message;
    expect(long.length).toBeLessThanOrEqual("/x failed (500): ".length + 200);
  });
  it("handles an empty body", () => {
    expect(errorFromResponse(404, "", "/x").message).toBe("/x failed (404)");
  });
});
