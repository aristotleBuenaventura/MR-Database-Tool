import { marketUsesRecycleCancel } from "../config/reports";

export type CommissionMode = "flat" | "tiered" | "dual-tiered";
export type CommissionApMetric = "active-players" | "ap-qualified";

export type CommissionTier = {
  minAp: number;
  percent: number;
  /** Dual-tiered: FINAL NET must also be >= this to use the band. */
  minFinalNet?: number;
};

export type TotalProfitLossMode = "gross" | "gross-recycle-cancel";

export type CommissionProfile = {
  mode: CommissionMode;
  /** Which Week Detail AP column Comm % uses. */
  apMetric: CommissionApMetric;
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
const MONTH_CODE = /^(\d{4})(0[1-9]|1[0-2])$/;

export function weekSortKey(week: string | null | undefined): number {
  const raw = String(week ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  const weekMatch = WEEK_CODE.exec(raw);
  if (weekMatch) return Number(weekMatch[1]) * 100 + Number(weekMatch[2]);
  const monthRaw = raw.replace(/[-/_.]/g, "");
  const monthMatch = MONTH_CODE.exec(monthRaw);
  if (monthMatch) return Number(monthMatch[1]) * 100 + Number(monthMatch[2]);
  return Number.NEGATIVE_INFINITY;
}

export function isCommissionWeekCode(week: string): boolean {
  const raw = week.trim().toUpperCase().replace(/\s+/g, "");
  if (WEEK_CODE.test(raw)) return true;
  return MONTH_CODE.test(raw.replace(/[-/_.]/g, ""));
}

const M1_REGULAR_TIERS: CommissionTier[] = [
  { minAp: 1, minFinalNet: 1, percent: 40 },
  { minAp: 6, minFinalNet: 300_000, percent: 45 },
  { minAp: 20, minFinalNet: 1_000_000, percent: 50 },
];

const M1_MONTHLY_TIERS: CommissionTier[] = [
  { minAp: 3, minFinalNet: 1, percent: 10 },
  { minAp: 5, minFinalNet: 1, percent: 40 },
  { minAp: 15, minFinalNet: 1_000_000, percent: 50 },
  { minAp: 20, minFinalNet: 3_000_000, percent: 51 },
];

const M2_REGULAR_TIERS: CommissionTier[] = [
  { minAp: 1, minFinalNet: 1, percent: 50 },
];

const M1_PROMO_TIERS: CommissionTier[] = [
  { minAp: 1, minFinalNet: 1, percent: 50 },
  { minAp: 20, minFinalNet: 500_001, percent: 52 },
];

const M2_PROMO_TIERS: CommissionTier[] = [
  { minAp: 1, percent: 50 },
  { minAp: 20, percent: 52 },
];

function apqDualProfile(
  tiers: CommissionTier[],
  profitLoss: TotalProfitLossMode,
): CommissionProfile {
  return {
    mode: "dual-tiered",
    apMetric: "ap-qualified",
    flatPercent: 50,
    minFinalNet: 1,
    minAp: 0,
    tiers,
    tierMinFinalNet: 1,
    tierMinAp: 1,
    deductionPercent: 18,
    totalProfitLoss: profitLoss,
  };
}

export function defaultCommissionProfile(
  marketId: string | null | undefined,
): CommissionProfile {
  const id = String(marketId ?? "").trim().toLowerCase();
  const profitLoss: TotalProfitLossMode = marketUsesRecycleCancel(id)
    ? "gross-recycle-cancel"
    : "gross";
  const b3b4 = id === "b3-bdt" || id === "b4-bdt";
  const standardTiers: CommissionTier[] = [
    { minAp: 1, percent: 50 },
    { minAp: 11, percent: 55 },
    { minAp: 20, percent: 60 },
  ];

  if (id === "m1-bdt") return apqDualProfile(M1_REGULAR_TIERS, profitLoss);
  if (id === "m1-bdt-monthly") return apqDualProfile(M1_MONTHLY_TIERS, profitLoss);
  if (id === "m1-bdt-promo") return apqDualProfile(M1_PROMO_TIERS, profitLoss);
  if (id === "m2-bdt") return apqDualProfile(M2_REGULAR_TIERS, profitLoss);
  if (id === "m2-bdt-promo") {
    return {
      mode: "tiered",
      apMetric: "ap-qualified",
      flatPercent: 50,
      minFinalNet: 1,
      minAp: 0,
      tiers: M2_PROMO_TIERS,
      tierMinFinalNet: 1,
      tierMinAp: 1,
      deductionPercent: 18,
      totalProfitLoss: profitLoss,
    };
  }

  return {
    mode: b3b4 ? "tiered" : "flat",
    apMetric: "active-players",
    flatPercent: 50,
    minFinalNet: 1,
    minAp: 0,
    tiers: standardTiers,
    tierMinFinalNet: 1,
    tierMinAp: 1,
    deductionPercent: b3b4 ? 20 : 18,
    totalProfitLoss: profitLoss,
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
      .map((tier) => `${tier.minAp}:${tier.minFinalNet ?? ""}:${tier.percent}`)
      .sort()
      .join("|");
  return (
    a.mode === b.mode &&
    a.apMetric === b.apMetric &&
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
  const apLabel =
    profile.apMetric === "ap-qualified" ? "AP Qualified (TO>3000)" : "AP(TO>0)";
  if (profile.mode === "dual-tiered") {
    const bands = [...profile.tiers]
      .sort((a, b) => a.minAp - b.minAp || (a.minFinalNet ?? 0) - (b.minFinalNet ?? 0))
      .map(
        (tier) =>
          `${apLabel} ≥ ${tier.minAp} and FINAL NET ≥ ${tier.minFinalNet ?? 0} = ${trimPercent(tier.percent)}%`,
      )
      .join("; ");
    return `Highest matching band (${bands}). Otherwise 0%. Deduction ${deduction}. ${profit}.`;
  }
  if (profile.mode === "tiered") {
    const bands = [...profile.tiers]
      .sort((a, b) => a.minAp - b.minAp)
      .map((tier) => `${apLabel} ${tier.minAp}+ = ${trimPercent(tier.percent)}%`)
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
  const tiersSource = Array.isArray(source.tiers) ? source.tiers : fallback.tiers;
  const incomingHasDual = tiersSource.some((tier) => {
    const row = tier && typeof tier === "object" ? (tier as Record<string, unknown>) : {};
    return row.minFinalNet != null && String(row.minFinalNet).trim() !== "";
  });
  const useFallbackTiers = fallback.mode === "dual-tiered" && !incomingHasDual;
  const tiers = (useFallbackTiers ? fallback.tiers : tiersSource)
    .map((tier) => {
      const row = tier && typeof tier === "object" ? (tier as Record<string, unknown>) : {};
      const parsed: CommissionTier = {
        minAp: Math.max(0, asNumber(row.minAp, 1)),
        percent: clampPercent(row.percent, 50),
      };
      if (fallback.mode === "dual-tiered" || row.minFinalNet != null) {
        parsed.minFinalNet = Math.max(0, asNumber(row.minFinalNet, 0));
      }
      return parsed;
    })
    .filter((tier) => Number.isFinite(tier.minAp))
    .slice(0, 8);
  const apMetric: CommissionApMetric =
    source.apMetric === "ap-qualified" || source.apMetric === "active-players"
      ? source.apMetric
      : fallback.apMetric;
  return {
    mode: fallback.mode,
    apMetric,
    flatPercent: clampPercent(source.flatPercent, fallback.flatPercent),
    minFinalNet: Math.max(0, asNumber(source.minFinalNet, fallback.minFinalNet)),
    minAp: Math.max(0, asNumber(source.minAp, fallback.minAp)),
    tiers: tiers.length > 0 ? tiers : fallback.tiers,
    tierMinFinalNet: Math.max(0, asNumber(source.tierMinFinalNet, fallback.tierMinFinalNet)),
    tierMinAp: Math.max(0, asNumber(source.tierMinAp, fallback.tierMinAp)),
    deductionPercent: clampPercent(source.deductionPercent, fallback.deductionPercent),
    totalProfitLoss: fallback.totalProfitLoss,
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
