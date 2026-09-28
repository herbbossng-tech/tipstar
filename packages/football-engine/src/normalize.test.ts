import { describe, expect, it } from "vitest";
import { isErr, isOk } from "@sport-os/shared";
import { requireNonEmptyString, requireNonNegativeInt, requirePositiveNumber, requireValidIsoDate } from "./normalize.js";

describe("requireNonEmptyString", () => {
  it("accepts a non-empty string", () => {
    const result = requireNonEmptyString("hello", "field");
    expect(isOk(result)).toBe(true);
  });
  it.each([undefined, null, 42, "", "   "])("rejects %p", (value) => {
    expect(isErr(requireNonEmptyString(value, "field"))).toBe(true);
  });
});

describe("requireValidIsoDate", () => {
  it("accepts and normalizes a valid ISO timestamp", () => {
    const result = requireValidIsoDate("2026-01-10T19:00:00Z", "field");
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value).toBe("2026-01-10T19:00:00.000Z");
  });
  it.each([undefined, null, "not-a-date", "", 123])("rejects %p", (value) => {
    expect(isErr(requireValidIsoDate(value, "field"))).toBe(true);
  });
});

describe("requireNonNegativeInt", () => {
  it.each([0, 1, 42])("accepts %p", (value) => {
    expect(isOk(requireNonNegativeInt(value, "field"))).toBe(true);
  });
  it.each([-1, 1.5, "1", undefined, null])("rejects %p", (value) => {
    expect(isErr(requireNonNegativeInt(value, "field"))).toBe(true);
  });
});

describe("requirePositiveNumber", () => {
  it.each([0.01, 1, 2.5])("accepts %p", (value) => {
    expect(isOk(requirePositiveNumber(value, "field"))).toBe(true);
  });
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, "2.1", undefined])("rejects %p", (value) => {
    expect(isErr(requirePositiveNumber(value, "field"))).toBe(true);
  });
});
