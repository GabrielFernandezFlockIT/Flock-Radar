import { describe, expect, it } from "vitest";

import {
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_JIRA_STORY_POINTS_FIELD,
  EnvValidationError,
  parseEnv,
} from "./env";

const liveSupabase = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
};

describe("parseEnv", () => {
  describe("defaults", () => {
    it("runs in demo mode when DEMO_MODE is unset", () => {
      expect(parseEnv({}).DEMO_MODE).toBe(true);
    });

    it("defaults the Anthropic model to claude-opus-5-5", () => {
      expect(parseEnv({}).ANTHROPIC_MODEL).toBe(DEFAULT_ANTHROPIC_MODEL);
      expect(DEFAULT_ANTHROPIC_MODEL).toBe("claude-opus-5-5");
    });

    it("keeps an explicit model override", () => {
      expect(parseEnv({ ANTHROPIC_MODEL: "custom-model" }).ANTHROPIC_MODEL).toBe(
        "custom-model",
      );
    });

    it("defaults the remaining optional settings", () => {
      const env = parseEnv({});
      expect(env.JIRA_STORY_POINTS_FIELD).toBe(DEFAULT_JIRA_STORY_POINTS_FIELD);
      expect(env.REMOTE_MCP_ENABLED).toBe(false);
      expect(env.GOOGLE_CALENDAR_IDS).toEqual([]);
      expect(env.CRON_SECRET).toBeUndefined();
    });

    it("treats blank values as unset", () => {
      const env = parseEnv({ DEMO_MODE: "", ANTHROPIC_MODEL: "  " });
      expect(env.DEMO_MODE).toBe(true);
      expect(env.ANTHROPIC_MODEL).toBe(DEFAULT_ANTHROPIC_MODEL);
    });
  });

  describe("boolean coercion", () => {
    it.each([
      ["true", true],
      ["false", false],
      ["1", true],
      ["0", false],
    ])("coerces DEMO_MODE=%s to %s", (raw, expected) => {
      expect(parseEnv({ ...liveSupabase, DEMO_MODE: raw }).DEMO_MODE).toBe(
        expected,
      );
    });

    it("rejects values that are not booleans", () => {
      expect(() => parseEnv({ DEMO_MODE: "maybe" })).toThrow(
        EnvValidationError,
      );
    });
  });

  describe("live mode", () => {
    it("fails when Supabase variables are missing", () => {
      expect(() => parseEnv({ DEMO_MODE: "false" })).toThrow(
        EnvValidationError,
      );
    });

    it("names every missing Supabase variable in the error", () => {
      try {
        parseEnv({ DEMO_MODE: "false" });
        expect.unreachable("parseEnv should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(EnvValidationError);
        const message = (error as Error).message;
        for (const key of Object.keys(liveSupabase)) {
          expect(message).toContain(key);
        }
        expect(message).toContain("DEMO_MODE=false");
      }
    });

    it("fails when only some Supabase variables are set", () => {
      const partial = { ...liveSupabase, SUPABASE_SERVICE_ROLE_KEY: undefined };
      expect(() => parseEnv({ DEMO_MODE: "false", ...partial })).toThrow(
        /SUPABASE_SERVICE_ROLE_KEY/,
      );
    });

    it("succeeds when all Supabase variables are set", () => {
      const env = parseEnv({ DEMO_MODE: "false", ...liveSupabase });
      expect(env.DEMO_MODE).toBe(false);
      expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe(liveSupabase.NEXT_PUBLIC_SUPABASE_URL);
    });

    it("does not require Supabase variables in demo mode", () => {
      expect(() => parseEnv({ DEMO_MODE: "true" })).not.toThrow();
    });
  });

  describe("value shaping", () => {
    it("splits calendar ids on commas and trims them", () => {
      expect(
        parseEnv({ GOOGLE_CALENDAR_IDS: " a@x.com, b@x.com ,," })
          .GOOGLE_CALENDAR_IDS,
      ).toEqual(["a@x.com", "b@x.com"]);
    });

    it("restores escaped newlines in the Google private key", () => {
      expect(
        parseEnv({ GOOGLE_PRIVATE_KEY: "line1\\nline2" }).GOOGLE_PRIVATE_KEY,
      ).toBe("line1\nline2");
    });

    it("rejects malformed URLs", () => {
      expect(() => parseEnv({ JIRA_BASE_URL: "not a url" })).toThrow(
        /JIRA_BASE_URL/,
      );
    });

    it.each(["http://localhost:3000", "http://127.0.0.1:54321", "https://x.io"])(
      "accepts the http(s) URL %s",
      (url) => {
        expect(parseEnv({ NEXT_PUBLIC_APP_URL: url }).NEXT_PUBLIC_APP_URL).toBe(
          url,
        );
      },
    );

    it.each(["localhost:3000", "javascript:alert(1)", "mailto:a@b.c", "ftp://x"])(
      "rejects the non-http(s) URL %s",
      (url) => {
        expect(() => parseEnv({ NEXT_PUBLIC_APP_URL: url })).toThrow(
          /NEXT_PUBLIC_APP_URL/,
        );
      },
    );

    it("trims surrounding whitespace, including trailing newlines", () => {
      const secret = "cron-secret-0123456789";
      expect(parseEnv({ CRON_SECRET: `${secret}\n` }).CRON_SECRET).toBe(secret);
      expect(parseEnv({ ANTHROPIC_MODEL: "  my-model \n" }).ANTHROPIC_MODEL).toBe(
        "my-model",
      );
    });
  });

  describe("CRON_SECRET", () => {
    it("is optional", () => {
      expect(parseEnv({}).CRON_SECRET).toBeUndefined();
    });

    it("rejects secrets shorter than 16 characters", () => {
      expect(() => parseEnv({ CRON_SECRET: "too-short" })).toThrow(
        /CRON_SECRET must be at least 16 characters/,
      );
    });

    it("accepts secrets of 16 characters or more", () => {
      expect(parseEnv({ CRON_SECRET: "a".repeat(16) }).CRON_SECRET).toBe(
        "a".repeat(16),
      );
    });
  });
});
