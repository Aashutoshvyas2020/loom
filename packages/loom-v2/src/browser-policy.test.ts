import { describe, expect, it } from "vitest";
import { isPrivateAddress } from "./browser-policy.js";

describe("browser network policy", () => {
  it("allows IANA's public 192.0.43.8 address without opening reserved 192.0.0.0/24", () => {
    expect(isPrivateAddress("192.0.43.8")).toBe(false);
    expect(isPrivateAddress("192.0.0.1")).toBe(true);
  });
});
