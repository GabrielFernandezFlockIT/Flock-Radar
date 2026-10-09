import { describe, expect, it } from "vitest";

import { issueRequiresCode } from "./issue";

describe("issueRequiresCode", () => {
  it.each(["Story", "Bug", "Task", "Sub-task", "Subtask", "Improvement", "New Feature", "Feature"])(
    "treats %s as code work",
    (type) => {
      expect(issueRequiresCode(type)).toBe(true);
    },
  );

  it.each(["Spike", "Epic", "Documentation", "Initiative", ""])(
    "treats %s as non-code work",
    (type) => {
      expect(issueRequiresCode(type)).toBe(false);
    },
  );

  it("is case- and whitespace-insensitive", () => {
    expect(issueRequiresCode("  story ")).toBe(true);
  });

  it("lets a docs label turn a code type into non-code work", () => {
    expect(issueRequiresCode("Sub-task", ["Docs"])).toBe(false);
    expect(issueRequiresCode("Task", ["no-code"])).toBe(false);
    expect(issueRequiresCode("Task", ["backend"])).toBe(true);
  });
});
