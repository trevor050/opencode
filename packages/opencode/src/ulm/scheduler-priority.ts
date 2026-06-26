export type SchedulerItemCategory =
  | "finalization"
  | "credential_safety"
  | "critical_capability"
  | "validation_debt"
  | "evidence_quality"
  | "high_impact_finding"
  | "coverage_expansion"
  | "extra_recon"

export type SchedulerCoverageImpact = "none" | "low" | "medium" | "high" | "blocks_release"

export type SchedulerPriorityInput = {
  now: string
  finalizationDue: boolean
  strategyHints?: Array<{
    title: string
    suggestedLane?: string
  }>
  items: Array<{
    id: string
    label?: string
    kind: "lane" | "command"
    category: SchedulerItemCategory
    coverageImpact: SchedulerCoverageImpact
    ageMinutes?: number
  }>
}

export type PrioritizedSchedulerItem = SchedulerPriorityInput["items"][number] & {
  priority: {
    score: number
    reason: string
  }
}

const CATEGORY_SCORE: Record<SchedulerItemCategory, number> = {
  finalization: 250,
  credential_safety: 900,
  critical_capability: 800,
  validation_debt: 700,
  evidence_quality: 650,
  high_impact_finding: 600,
  coverage_expansion: 300,
  extra_recon: 100,
}

const IMPACT_SCORE: Record<SchedulerCoverageImpact, number> = {
  none: 0,
  low: 10,
  medium: 25,
  high: 50,
  blocks_release: 100,
}

function priorityReason(input: { category: SchedulerItemCategory; finalizationDue: boolean }) {
  if (input.category === "finalization" && input.finalizationDue) return "protected finalization work blocks handoff"
  if (input.category === "critical_capability") return "critical capability gap blocks meaningful 48-hour coverage"
  if (input.category === "validation_debt") return "validation debt must be resolved before report-ready claims"
  if (input.category === "evidence_quality") return "evidence quality gap can invalidate final report claims"
  if (input.category === "credential_safety") return "credential or safety blocker must be resolved before launch"
  if (input.category === "high_impact_finding") return "high-impact finding work improves report value"
  if (input.category === "coverage_expansion") return "coverage expansion fills known gaps"
  return "extra recon has low priority unless higher-value work is clear"
}

function words(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3)
}

function strategyHintBoost(input: {
  itemID: string
  itemLabel?: string
  hints: NonNullable<SchedulerPriorityInput["strategyHints"]>
}) {
  const haystack = `${input.itemID} ${input.itemLabel ?? ""}`.toLowerCase()
  for (const hint of input.hints) {
    if (hint.suggestedLane && hint.suggestedLane === input.itemID) {
      return { score: 75, reason: `strategy hint suggested lane ${hint.suggestedLane}` }
    }
    const hintWords = words(`${hint.title} ${hint.suggestedLane ?? ""}`)
    if (hintWords.some((word) => haystack.includes(word))) {
      return { score: 40, reason: `strategy hint matched ${hint.title}` }
    }
  }
  return { score: 0, reason: "" }
}

export function prioritizeSchedulerItems(input: SchedulerPriorityInput): PrioritizedSchedulerItem[] {
  return input.items
    .map((item) => {
      const baseCategoryScore =
        item.category === "finalization" && input.finalizationDue ? 1000 : CATEGORY_SCORE[item.category]
      const hint = strategyHintBoost({
        itemID: item.id,
        itemLabel: item.label,
        hints: input.strategyHints ?? [],
      })
      const score =
        baseCategoryScore +
        IMPACT_SCORE[item.coverageImpact] +
        Math.min(60, Math.max(0, item.ageMinutes ?? 0) / 10) +
        hint.score
      return {
        ...item,
        priority: {
          score,
          reason: [
            priorityReason({ category: item.category, finalizationDue: input.finalizationDue }),
            hint.reason,
          ].filter(Boolean).join("; "),
        },
      }
    })
    .sort((left, right) => {
      if (right.priority.score !== left.priority.score) return right.priority.score - left.priority.score
      return left.id.localeCompare(right.id)
    })
}
