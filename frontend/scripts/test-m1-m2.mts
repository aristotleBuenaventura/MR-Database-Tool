import {
  defaultCommissionProfile,
} from "../src/lib/commissionSettings.ts";
import {
  computeCommPct,
  commissionApValue,
  computeFinalNet,
  computeWeeklyDetail,
  dropUsersFromWeekDetail,
  usernamesFromWeekDetail,
  usernamesFromAffRaw,
} from "../src/lib/weeklyCompute.ts";
import {
  WEEKLY_DETAIL_COLUMNS,
  partnerWeeklyMarketId,
  periodCopy,
  periodizeDetailColumn,
  reportTabsForMarket,
  isPromoWeeklyMarket,
  weekDetailColumnsForMarket,
  PROMO_HIDDEN_TAB_IDS,
} from "../src/config/reports.ts";

let failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = Object.is(actual, expected) || actual === expected;
  if (!ok) failed += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}: ${JSON.stringify(actual)} (expected ${JSON.stringify(expected)})`);
}

function pct(market: string, ap: number, apq: number, fn: number) {
  const profile = defaultCommissionProfile(market);
  const used = commissionApValue(ap, apq, market, profile);
  return Math.round(computeCommPct(used, fn, market, profile) * 100);
}

console.log("\n=== Comm % ===");
check("M2 Regular APQ1 FN100", pct("m2-bdt", 0, 1, 100), 50);
check("M2 Regular AP>0 APQ0 FN100", pct("m2-bdt", 5, 0, 100), 0);
check("M2 Regular APQ0 FN1e6", pct("m2-bdt", 20, 0, 1_000_000), 0);
check("M1 Regular APQ1 FN100", pct("m1-bdt", 20, 1, 100), 40);
check("M1 Regular APQ5 FN300k stays 40", pct("m1-bdt", 1, 5, 300_000), 40);
check("M1 Regular APQ6 FN300k", pct("m1-bdt", 1, 6, 300_000), 45);
check("M1 Regular APQ20 FN1e6", pct("m1-bdt", 1, 20, 1_000_000), 50);
check("M1 Regular APQ20 FN5k stays 40", pct("m1-bdt", 1, 20, 5000), 40);
check("M1 Regular AP=20 APQ=0 FN1e6", pct("m1-bdt", 20, 0, 1_000_000), 0);
check("M2 Promo APQ1 FN100", pct("m2-bdt-promo", 0, 1, 100), 50);
check("M2 Promo APQ20 FN100 is 52", pct("m2-bdt-promo", 0, 20, 100), 52);
check("M2 Promo APQ20 FN0", pct("m2-bdt-promo", 0, 20, 0), 0);
check("M1 Promo APQ20 FN100 stays 50", pct("m1-bdt-promo", 0, 20, 100), 50);
check("M1 Promo APQ20 FN500001", pct("m1-bdt-promo", 0, 20, 500_001), 52);
check("M1 Monthly APQ3 FN100", pct("m1-bdt-monthly", 0, 3, 100), 10);
check("M1 Monthly APQ5 FN100", pct("m1-bdt-monthly", 0, 5, 100), 40);
check("M1 Monthly APQ15 FN1e6", pct("m1-bdt-monthly", 0, 15, 1_000_000), 50);
check("M1 Monthly APQ20 FN3e6", pct("m1-bdt-monthly", 0, 20, 3_000_000), 51);
check("M1 Monthly APQ20 FN1e6 stays 50", pct("m1-bdt-monthly", 0, 20, 1_000_000), 50);
check("TK unchanged 50", pct("tk-bdt", 1, 0, 100), 50);

console.log("\n=== NCF formula ===");
check("FN = last + net (negative)", computeFinalNet(-1000, 200), -800);
check("FN = last + net (positive)", computeFinalNet(-100, 500), 400);
check("FN zero", computeFinalNet(0, 0), 0);
check("Next NCF when FN<0", computeFinalNet(-50, -10) < 0 ? computeFinalNet(-50, -10) : 0, -60);
check("Next NCF when FN>0", 400 < 0 ? 400 : 0, 0);

console.log("\n=== Market wiring ===");
check("partner of m2 regular", partnerWeeklyMarketId("m2-bdt"), "m2-bdt-promo");
check("partner of m2 promo", partnerWeeklyMarketId("m2-bdt-promo"), "m2-bdt");
check("partner of tk", partnerWeeklyMarketId("tk-bdt"), null);
check("m2-bdt-promo is promo", isPromoWeeklyMarket("m2-bdt-promo"), true);
check("m2-bdt is not promo", isPromoWeeklyMarket("m2-bdt"), false);
const promoTabs = reportTabsForMarket("m2-bdt-promo").map((t) => t.id);
check(
  "promo hides weekly-summary",
  promoTabs.includes("weekly-summary"),
  false,
);
check("promo hides business-raw", promoTabs.includes("business-raw"), false);
check("promo keeps week-detail", promoTabs.includes("week-detail"), true);
check("promo keeps aff-raw", promoTabs.includes("aff-raw-upload"), true);
check(
  "regular keeps weekly-summary",
  reportTabsForMarket("m2-bdt").some((t) => t.id === "weekly-summary"),
  true,
);
check("hidden set has 2 tabs", PROMO_HIDDEN_TAB_IDS.size, 2);
check(
  "monthly week-detail label",
  reportTabsForMarket("m1-bdt-monthly").find((t) => t.id === "week-detail")?.label,
  "Month Detail",
);
check(
  "monthly summary label",
  reportTabsForMarket("m1-bdt-monthly").find((t) => t.id === "weekly-summary")?.label,
  "Monthly Summary",
);
check(
  "weekly week-detail label",
  reportTabsForMarket("m2-bdt").find((t) => t.id === "week-detail")?.label,
  "Week Detail",
);
check(
  "monthly Week column",
  periodizeDetailColumn("Week", "m1-bdt-monthly"),
  "Month",
);
check(
  "monthly Last Week NCF column",
  periodizeDetailColumn("Last Week Negative Carry Over", "m1-bdt-monthly"),
  "Last Month Negative Carry Over",
);
check(
  "monthly Next Week NCF column",
  periodizeDetailColumn("Next Week Negative Carry Over", "m1-bdt-monthly"),
  "Next Month Negative Carry Over",
);
check(
  "weekly Week column stays",
  periodizeDetailColumn("Week", "m2-bdt"),
  "Week",
);
check(
  "monthly detail first column",
  weekDetailColumnsForMarket("m1-bdt-monthly")[0],
  "Month",
);
check("monthly period key", periodCopy("m1-bdt-monthly").periodKey, "Month");
check("weekly period key", periodCopy("m2-bdt").periodKey, "Month/Week");
check("monthly ncf label", periodCopy("m1-bdt-monthly").ncf, "Last Month NCF");

function detailRow(username: string, nextNcf: number, finalComm = 0) {
  const row = WEEKLY_DETAIL_COLUMNS.map(() => "");
  row[WEEKLY_DETAIL_COLUMNS.indexOf("Week")] = "2026W40";
  row[WEEKLY_DETAIL_COLUMNS.indexOf("Affiliate Username")] = username;
  row[WEEKLY_DETAIL_COLUMNS.indexOf("Final Commission")] = String(finalComm);
  row[WEEKLY_DETAIL_COLUMNS.indexOf("Next Week Negative Carry Over")] =
    String(nextNcf);
  return row;
}

function affRawRow(username: string, ap: number, gross: number) {
  const row = Array.from({ length: 24 }, () => "");
  row[0] = "2026W41";
  row[3] = username;
  row[10] = String(ap);
  row[17] = String(gross);
  row[19] = "0";
  row[20] = "0";
  return row;
}

console.log("\n=== NCF follows affiliate Regular → Promo ===");
const mover = "promo_mover";
const stayed = "regular_stayer";
const promoDetail = computeWeeklyDetail({
  week: "2026W41",
  marketId: "m2-bdt-promo",
  sources: {
    "aff-raw-upload": [affRawRow(mover, 2, 1000)],
  },
  prevWeekDetail: [],
  prevPartnerWeekDetail: [
    detailRow(mover, -2500, 0),
    detailRow(stayed, -900, 0),
  ],
  partnerCurrentUsernames: new Set([stayed]),
});
const cols = WEEKLY_DETAIL_COLUMNS;
const iUser = cols.indexOf("Affiliate Username");
const iLast = cols.indexOf("Last Week Negative Carry Over");
const iNext = cols.indexOf("Next Week Negative Carry Over");
const iFn = cols.indexOf("FINAL NET");
const promoUsers = promoDetail.map((r) => r[iUser]);
check("promo includes mover", promoUsers.includes(mover), true);
check("promo does not include regular stayer", promoUsers.includes(stayed), false);
const moverRow = promoDetail.find((r) => r[iUser] === mover)!;
check("mover Last Week NCF from Regular W40", Number(moverRow[iLast]), -2500);

console.log("\n=== NCF leftover row stays if not moved ===");
const regularCarry = computeWeeklyDetail({
  week: "2026W41",
  marketId: "m2-bdt",
  sources: { "aff-raw-upload": [] },
  prevWeekDetail: [detailRow(stayed, -900), detailRow(mover, -2500)],
  prevPartnerWeekDetail: [],
  partnerCurrentUsernames: new Set([mover.toLowerCase()]),
});
const regularUsers = regularCarry.map((r) => String(r[iUser]).toLowerCase());
check("regular keeps stayer NCF-only", regularUsers.includes(stayed), true);
check("regular drops mover already on promo", regularUsers.includes(mover), false);
check(
  "stayer last ncf -900",
  Number(regularCarry.find((r) => r[iUser] === stayed)?.[iLast]),
  -900,
);

console.log("\n=== dropUsersFromWeekDetail ===");
const dropped = dropUsersFromWeekDetail(
  [detailRow(mover, -1), detailRow(stayed, -2)],
  new Set([mover]),
  "m2-bdt",
);
check("drop removes mover", dropped.length, 1);
check("drop keeps stayer", dropped[0]![iUser], stayed);
check(
  "usernamesFromWeekDetail",
  [...usernamesFromWeekDetail([detailRow("Alice", -1)], "m2-bdt")].join(),
  "alice",
);

console.log("\n=== Deduction / next NCF on promo compute ===");
// Gross 1000, deduction 18% = 180, TPL=1000 > 0 so NP = 1000-180-0-0 = 820
// Last NCF -2500 + 820 = -1680 → next NCF -1680
check("mover FINAL NET", Number(moverRow[iFn]), -1680);
check("mover Next Week NCF", Number(moverRow[iNext]), -1680);

console.log("\n=== Copied System Comm does not steal sibling roster ===");
function sysCommRow(username: string) {
  const row = Array.from({ length: 12 }, () => "");
  row[0] = "2026W41";
  row[2] = username;
  row[7] = "500";
  return row;
}
const stolen = "regular_paid";
const promoFromCopy = computeWeeklyDetail({
  week: "2026W41",
  marketId: "m2-bdt-promo",
  sources: {
    "aff-raw-upload": [affRawRow(mover, 2, 1000)],
    "system-comm-raw": [sysCommRow(mover), sysCommRow(stolen), sysCommRow(stayed)],
  },
  prevWeekDetail: [],
  prevPartnerWeekDetail: [detailRow(stayed, -900), detailRow(stolen, -100)],
  partnerCurrentUsernames: new Set([stayed, stolen]),
});
const copyUsers = promoFromCopy.map((r) => String(r[iUser]).toLowerCase());
check("promo keeps own aff raw user", copyUsers.includes(mover), true);
check("promo ignores copied regular paid", copyUsers.includes(stolen), false);
check("promo ignores copied regular stayer", copyUsers.includes(stayed), false);
check(
  "aff raw usernames helper",
  [...usernamesFromAffRaw([affRawRow("Bob", 1, 10)], "2026W41")].join(),
  "bob",
);

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nAll checks passed");
