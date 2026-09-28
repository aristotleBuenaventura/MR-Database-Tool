import { marketUsesRecycleCancel } from "../config/reports";

export type CommissionTier = {
  minAp: number;
  percent: number;
};

export type TotalProfitLossMode = "gross" | "gross-recycle-cancel";

export type CommissionProfile = {
  mode: "flat" | "tiered";
  /** Flat Comm % (0–100). Applies when FINAL NET >= minFinalNet and AP > minAp. */
  flatPercent: number;
  minFinalNet: number;
  minAp: number;
  tiers: CommissionTier[];
  tierMinFinalNet: number;
  tierMinAp: number;
  /** Deduction percent of Gross Revenue when Gross > 0. */
  deductionPercent: number;
  totalProfitLoss: TotalProfitLossMode;
};

export type CommissionVersion = {
  /** Null means this profile applies from the first week. */
  effectiveFromWeek: string | null;
  profile: CommissionProfile;
};

export type CommissionSettings = {
  versions: CommissionVersion[];
};

const WEEK_CODE = /^(\d{4})W(\d{1,2})$/i;

export function weekSortKey(week: string | null | undefined): number {
  const match = WEEK_CODE.exec(String(week ?? "").trim());
  if (!match) return Number.NEGATIVE_INFINITY;
  return Number(match[1]) * 100 + Number(match[2]);
}

export function isCommissionWeekCode(week: string): boolean {
  return WEEK_CODE.test(week.trim());
}

export function defaultCommissionProfile(
  marketId: string | null | undefined,
): CommissionProfile {
  const id = String(marketId ?? "").trim().toLowerCase();
  const tiered = id === "b3-bdt" || id === "b4-bdt";
  const standardTiers: CommissionTier[] = [
    { minAp: 1, percent: 50 },
    { minAp: 11, percent: 55 },
    { minAp: 20, percent: 60 },
  ];
  return {
    mode: tiered ? "tiered" : "flat",
    flatPercent: 50,
    minFinalNet: 1,
    minAp: 0,
    tiers: standardTiers,
    tierMinFinalNet: 1,
    tierMinAp: 1,
    deductionPercent: tiered ? 20 : 18,
    totalProfitLoss: marketUsesRecycleCancel(id)
      ? "gross-recycle-cancel"
      : "gross",
  };
}

export function defaultCommissionSettings(
  marketId: string | null | undefined,
): CommissionSettings {
  return {
    versions: [
      {
        effectiveFromWeek: null,
        profile: defaultCommissionProfile(marketId),
      },
    ],
  };
}

export function resolveCommissionProfile(
  marketId: string | null | undefined,
  week: string | null | undefined,
  settings: CommissionSettings | null | undefined,
): CommissionProfile {
  const baseline = defaultCommissionProfile(marketId);
  const versions = settings?.versions ?? [];
  if (versions.length === 0) return baseline;

  const target = weekSortKey(week);
  const sorted = [...versions].sort(
    (a, b) => weekSortKey(a.effectiveFromWeek) - weekSortKey(b.effectiveFromWeek),
  );
  let chosen = baseline;
  for (const version of sorted) {
    if (weekSortKey(version.effectiveFromWeek) <= target) {
      chosen = version.profile;
    }
  }
  return chosen;
}

export function latestCommissionVersion(
  settings: CommissionSettings,
): CommissionVersion {
  const dated = settings.versions.filter((version) => version.effectiveFromWeek);
  if (dated.length === 0) {
    return (
      settings.versions[0] ?? {
        effectiveFromWeek: null,
        profile: defaultCommissionProfile(null),
      }
    );
  }
  return [...dated].sort(
    (a, b) =>
      weekSortKey(b.effectiveFromWeek) - weekSortKey(a.effectiveFromWeek),
  )[0]!;
}

/**
 * Save a profile. Exempt earlier weeks keeps every version before the cutoff.
 * Turning exemption off replaces history with one profile for every week.
 */
export function applyCommissionSettingsUpdate(
  settings: CommissionSettings,
  profile: CommissionProfile,
  effectiveFromWeek: string | null,
  exemptEarlierWeeks: boolean,
): CommissionSettings {
  if (!exemptEarlierWeeks) {
    return { versions: [{ effectiveFromWeek: null, profile }] };
  }
  const week = String(effectiveFromWeek ?? "").trim().toUpperCase();
  const kept = settings.versions.filter(
    (version) =>
      String(version.effectiveFromWeek ?? "").toUpperCase() !== week,
  );
  kept.push({ effectiveFromWeek: week, profile });
  return { versions: kept };
}

export function commissionProfilesMatch(
  a: CommissionProfile,
  b: CommissionProfile,
): boolean {
  const tierKey = (tiers: CommissionTier[]) =>
    [...tiers]
      .map((tier) => `${tier.minAp}:${tier.percent}`)
      .sort()
      .join("|");
  return (
    a.mode === b.mode &&
    a.flatPercent === b.flatPercent &&
    a.minFinalNet === b.minFinalNet &&
    a.minAp === b.minAp &&
    a.tierMinFinalNet === b.tierMinFinalNet &&
    a.tierMinAp === b.tierMinAp &&
    a.deductionPercent === b.deductionPercent &&
    a.totalProfitLoss === b.totalProfitLoss &&
    tierKey(a.tiers) === tierKey(b.tiers)
  );
}

export function describeCommissionProfile(profile: CommissionProfile): string {
  const deduction = `${trimPercent(profile.deductionPercent)}% of Gross Revenue when Gross > 0`;
  const profit =
    profile.totalProfitLoss === "gross-recycle-cancel"
      ? "Total Profit & Loss = Gross + Recycle Amount + Cancel Fee"
      : "Total Profit & Loss = Gross Revenue";
  if (profile.mode === "tiered") {
    const bands = [...profile.tiers]
      .sort((a, b) => a.minAp - b.minAp)
      .map((tier) => `AP ${tier.minAp}+ = ${trimPercent(tier.percent)}%`)
      .join(", ");
    return `Tiered (${bands}). 0% when FINAL NET < ${profile.tierMinFinalNet} or AP < ${profile.tierMinAp}. Deduction ${deduction}. ${profit}.`;
  }
  return `${trimPercent(profile.flatPercent)}% when FINAL NET ≥ ${profile.minFinalNet} and AP > ${profile.minAp}. Otherwise 0%. Deduction ${deduction}. ${profit}.`;
}

function trimPercent(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return String(Math.round(value * 100) / 100);
}

function asNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clampPercent(value: unknown, fallback: number): number {
  return Math.min(100, Math.max(0, asNumber(value, fallback)));
}

export function sanitizeCommissionProfile(
  raw: unknown,
  marketId?: string | null,
): CommissionProfile {
  const fallback = defaultCommissionProfile(marketId);
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const mode = source.mode === "tiered" ? "tiered" : source.mode === "flat" ? "flat" : fallback.mode;
  const tiersSource = Array.isArray(source.tiers) ? source.tiers : fallback.tiers;
  const tiers = tiersSource
    .map((tier) => {
      const row = tier && typeof tier === "object" ? (tier as Record<string, unknown>) : {};
      return {
        minAp: Math.max(0, asNumber(row.minAp, 1)),
        percent: clampPercent(row.percent, 50),
      };
    })
    .filter((tier) => Number.isFinite(tier.minAp))
    .slice(0, 8);
  const totalProfitLoss =
    source.totalProfitLoss === "gross-recycle-cancel" || source.totalProfitLoss === "gross"
      ? source.totalProfitLoss
      : fallback.totalProfitLoss;
  return {
    mode,
    flatPercent: clampPercent(source.flatPercent, fallback.flatPercent),
    minFinalNet: Math.max(0, asNumber(source.minFinalNet, fallback.minFinalNet)),
    minAp: Math.max(0, asNumber(source.minAp, fallback.minAp)),
    tiers: tiers.length > 0 ? tiers : fallback.tiers,
    tierMinFinalNet: Math.max(0, asNumber(source.tierMinFinalNet, fallback.tierMinFinalNet)),
    tierMinAp: Math.max(0, asNumber(source.tierMinAp, fallback.tierMinAp)),
    deductionPercent: clampPercent(source.deductionPercent, fallback.deductionPercent),
    totalProfitLoss,
  };
}

export function sanitizeCommissionSettings(
  raw: unknown,
  marketId?: string | null,
): CommissionSettings {
  const fallback = defaultCommissionSettings(marketId);
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const versionsSource = Array.isArray(source.versions) ? source.versions : [];
  const versions: CommissionVersion[] = [];
  for (const item of versionsSource.slice(0, 50)) {
    const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const weekRaw = row.effectiveFromWeek;
    const week =
      weekRaw == null || String(weekRaw).trim() === ""
        ? null
        : String(weekRaw).trim().toUpperCase();
    if (week && !isCommissionWeekCode(week)) continue;
    versions.push({
      effectiveFromWeek: week,
      profile: sanitizeCommissionProfile(row.profile, marketId),
    });
  }
  if (versions.length === 0) return fallback;
  return { versions };
}
