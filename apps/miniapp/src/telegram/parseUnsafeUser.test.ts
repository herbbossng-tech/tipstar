import { describe, expect, it } from "vitest";
import { parseUnsafeTelegramUser } from "./parseUnsafeUser.js";

describe("parseUnsafeTelegramUser", () => {
  it("returns undefined when initData is undefined", () => {
    expect(parseUnsafeTelegramUser(undefined)).toBeUndefined();
  });

  it("returns undefined when initData has no user field", () => {
    expect(parseUnsafeTelegramUser("auth_date=123&hash=abc")).toBeUndefined();
  });

  it("returns undefined for malformed user JSON, never throws", () => {
    const initData = "user=" + encodeURIComponent("{not json") + "&auth_date=123";
    expect(() => parseUnsafeTelegramUser(initData)).not.toThrow();
    expect(parseUnsafeTelegramUser(initData)).toBeUndefined();
  });

  it("extracts display fields from a well-formed user field", () => {
    const user = { id: 42, first_name: "Ada", last_name: "Lovelace", username: "ada", language_code: "en" };
    const initData = "user=" + encodeURIComponent(JSON.stringify(user)) + "&auth_date=123&hash=abc";

    const result = parseUnsafeTelegramUser(initData);

    expect(result).toEqual({ id: 42, firstName: "Ada", lastName: "Lovelace", username: "ada", languageCode: "en" });
  });
});
