import { describe, expect, test } from "bun:test"
import { normalizeStrategyMemo } from "@/ulm/operation-strategy"

describe("ULM operation strategy memo", () => {
  test("accepts minimal next-action items", () => {
    const memo = normalizeStrategyMemo({
      operationID: "School",
      items: [{ title: "Inspect logged-in SIS role surfaces", why: "Student-data access is high value." }],
    })

    expect(memo.operationID).toBe("school")
    expect(memo.items).toHaveLength(1)
    expect(memo.items[0]?.title).toBe("Inspect logged-in SIS role surfaces")
    expect(memo.items[0]?.why).toBe("Student-data access is high value.")
    expect(memo.gaps).toEqual([])
  })

  test("keeps imperfect model output as hints instead of rejecting everything", () => {
    const memo = normalizeStrategyMemo({
      operationID: "school",
      items: [{ title: "Review Google Admin MFA gaps" }, { why: "This item is too vague." }],
    })

    expect(memo.items).toHaveLength(1)
    expect(memo.items[0]?.title).toBe("Review Google Admin MFA gaps")
    expect(memo.gaps).toContain("item 1 missing title")
  })
})
