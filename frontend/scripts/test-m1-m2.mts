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
  parsePromoEndedRows,
  promoEndedRecordsForWeek,
} from "../src/lib/weeklyCompute.ts";
import {
  detectSheetTab,
  pickPrimaryWeekFromImported,
  splitRowsByWeek,
  type ImportedSources,
} from "../src/lib/weeklyImport.ts";
import {
  TAB_COLUMNS,
  WEEKLY_DETAIL_COLUMNS,
  partnerWeeklyMarketId,
  labelForTab,
  periodCopy,
  periodizeDetailColumn,
  periodizeUserMessage,
  reportTabsForMarket,
  isPromoWeeklyMarket,
  weekDetailColumnsForMarket,
  storageMarketIdForTab,
  PROMO_SHARED_FROM_REGULAR_TAB_IDS,
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
check("partner of m1 regular", partnerWeeklyMarketId("m1-bdt"), "m1-bdt-promo");
check("partner of m1 promo", partnerWeeklyMarketId("m1-bdt-promo"), "m1-bdt");
check("partner of tk", partnerWeeklyMarketId("tk-bdt"), null);
check("m2-bdt-promo is promo", isPromoWeeklyMarket("m2-bdt-promo"), true);
check("m1-bdt-promo is promo", isPromoWeeklyMarket("m1-bdt-promo"), true);
check("m2-bdt is not promo", isPromoWeeklyMarket("m2-bdt"), false);
check("m1-bdt is not promo", isPromoWeeklyMarket("m1-bdt"), false);
const promoTabs = reportTabsForMarket("m2-bdt-promo").map((t) => t.id);
check(
  "promo shows weekly-summary",
  promoTabs.includes("weekly-summary"),
  true,
);
check("promo shows business-raw", promoTabs.includes("business-raw"), true);
check("promo keeps week-detail", promoTabs.includes("week-detail"), true);
check("promo keeps aff-raw", promoTabs.includes("aff-raw-upload"), true);
check("promo shows promo-ended", promoTabs.includes("promo-ended"), true);
check(
  "m1 promo shows promo-ended",
  reportTabsForMarket("m1-bdt-promo").some((t) => t.id === "promo-ended"),
  true,
);
check(
  "regular hides promo-ended",
  reportTabsForMarket("m2-bdt").some((t) => t.id === "promo-ended"),
  false,
);
check(
  "m1 regular hides promo-ended",
  reportTabsForMarket("m1-bdt").some((t) => t.id === "promo-ended"),
  false,
);
check(
  "promo-ended stored on promo",
  storageMarketIdForTab("m2-bdt-promo", "promo-ended"),
  "m2-bdt-promo",
);
check(
  "regular keeps weekly-summary",
  reportTabsForMarket("m2-bdt").some((t) => t.id === "weekly-summary"),
  true,
);
check("shared set has 2 tabs", PROMO_SHARED_FROM_REGULAR_TAB_IDS.size, 2);
check(
  "promo summary stored on regular",
  storageMarketIdForTab("m2-bdt-promo", "weekly-summary"),
  "m2-bdt",
);
check(
  "promo braw stored on regular",
  storageMarketIdForTab("m2-bdt-promo", "business-raw"),
  "m2-bdt",
);
check(
  "promo week-detail stays on promo",
  storageMarketIdForTab("m2-bdt-promo", "week-detail"),
  "m2-bdt-promo",
);
check(
  "regular braw stays on regular",
  storageMarketIdForTab("m2-bdt", "business-raw"),
  "m2-bdt",
);
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
check(
  "monthly required toast",
  periodizeUserMessage("marketId, week, and tabId are required", "m1-bdt-monthly"),
  "marketId, month, and tabId are required",
);
check(
  "weekly required toast stays",
  periodizeUserMessage("marketId, week, and tabId are required", "m2-bdt"),
  "marketId, week, and tabId are required",
);
check(
  "monthly quoted scope stays week",
  periodizeUserMessage("scope must be 'tab' or 'week'", "m1-bdt-monthly"),
  "scope must be 'tab' or 'week'",
);
check(
  "monthly failed to load weeks",
  periodizeUserMessage("Failed to load weeks", "m1-bdt-monthly"),
  "Failed to load months",
);
check(
  "monthly heading label",
  labelForTab("week-detail", "m1-bdt-monthly"),
  "Month Detail",
);
check(
  "monthly summary heading",
  labelForTab("weekly-summary", "m1-bdt-monthly"),
  "Monthly Summary",
);
check(
  "weekly heading stays Week Detail",
  labelForTab("week-detail", "m2-bdt"),
  "Week Detail",
);
check("monthly Weeks label", periodCopy("m1-bdt-monthly").Weeks, "Months");

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

console.log("\n=== Promo Ended sheet ===");
check("detect Promo Ended sheet", detectSheetTab("Promo Ended"), "promo-ended");
check("detect promo ended spaces", detectSheetTab("  promo ended"), "promo-ended");
const parsedEnded = parsePromoEndedRows([
  ["2026W41", "honor750", "2026W40"],
  ["2026w41", "Honor750", "2026W40"],
  ["", "skipme", "2026W40"],
]);
check("parse promo ended unique username+week", parsedEnded.length, 1);
check("parse transfer week", parsedEnded[0]?.transferWeek, "2026W41");
check("parse promo ended week", parsedEnded[0]?.promoEndedWeek, "2026W40");
check(
  "records for other week empty",
  promoEndedRecordsForWeek(parsedEnded, "2026W42").length,
  0,
);

console.log("\n=== Promo Ended → Regular even with no Aff Raw ===");
const honor = "honor750";
const regularFromList = computeWeeklyDetail({
  week: "2026W41",
  marketId: "m2-bdt",
  sources: { "aff-raw-upload": [] },
  prevWeekDetail: [],
  prevPartnerWeekDetail: [detailRow(honor, -1200)],
  partnerCurrentUsernames: new Set(),
  transferInUsernames: [honor],
  siblingAffRawUsernames: [],
});
const regularFromListUsers = regularFromList.map((r) => r[iUser]);
check("regular includes zero-TO transfer", regularFromListUsers.includes(honor), true);
const honorRegular = regularFromList.find((r) => r[iUser] === honor)!;
check("regular Last Week NCF from Promo W40", Number(honorRegular[iLast]), -1200);
check("regular Next NCF still carries", Number(honorRegular[iNext]), -1200);

const regularZeroNcf = computeWeeklyDetail({
  week: "2026W41",
  marketId: "m1-bdt",
  sources: { "aff-raw-upload": [] },
  prevWeekDetail: [],
  prevPartnerWeekDetail: [detailRow(honor, 0)],
  transferInUsernames: [honor],
});
check(
  "regular shows transfer even if NCF 0",
  regularZeroNcf.map((r) => r[iUser]).includes(honor),
  true,
);

const promoLeftoverDropped = computeWeeklyDetail({
  week: "2026W41",
  marketId: "m2-bdt-promo",
  sources: { "aff-raw-upload": [] },
  prevWeekDetail: [detailRow(honor, -1200)],
  partnerCurrentUsernames: new Set([honor.toLowerCase()]),
});
check(
  "promo drops transferred leftover",
  promoLeftoverDropped.map((r) => r[iUser]).includes(honor),
  false,
);

const regularIfStillPromo = computeWeeklyDetail({
  week: "2026W41",
  marketId: "m2-bdt",
  sources: { "aff-raw-upload": [] },
  prevPartnerWeekDetail: [detailRow(honor, -1200)],
  transferInUsernames: [honor],
  siblingAffRawUsernames: new Set([honor.toLowerCase()]),
});
check(
  "regular skips transfer if Promo Aff Raw this week",
  regularIfStillPromo.map((r) => r[iUser]).includes(honor),
  false,
);

const promoAffRawWins = computeWeeklyDetail({
  week: "2026W41",
  marketId: "m2-bdt-promo",
  sources: { "aff-raw-upload": [affRawRow(honor, 1, 100)] },
  prevWeekDetail: [detailRow(honor, -1200)],
  partnerCurrentUsernames: new Set(),
});
check(
  "promo keeps Aff Raw even if listed for transfer",
  promoAffRawWins.map((r) => r[iUser]).includes(honor),
  true,
);

function namesOf(rows: string[][]): string[] {
  return rows.map((row) => row[iUser]);
}

function runPromoEndedSuite(regularId: string, promoId: string) {
  const tag = regularId.replace("-bdt", "").toUpperCase();
  const zeroTo = `${tag.toLowerCase()}_zero_to`;
  const zeroNcf = `${tag.toLowerCase()}_zero_ncf`;
  const listedActive = `${tag.toLowerCase()}_listed_active`;
  const stillPromo = `${tag.toLowerCase()}_still_promo`;
  const leftover = `${tag.toLowerCase()}_promo_leftover`;
  const regularOnly = `${tag.toLowerCase()}_regular_only`;
  const promoOnly = `${tag.toLowerCase()}_promo_only`;
  const skipped = `${tag.toLowerCase()}_not_listed`;

  console.log(`\n=== ${tag} Regular weekly roster ===`);
  const regularWeekly = computeWeeklyDetail({
    week: "2026W41",
    marketId: regularId,
    sources: {
      "aff-raw-upload": [
        affRawRow(regularOnly, 3, 500),
        affRawRow(listedActive, 2, 800),
      ],
    },
    prevWeekDetail: [detailRow(regularOnly, -50)],
    prevPartnerWeekDetail: [detailRow(promoOnly, -777)],
    partnerCurrentUsernames: new Set([promoOnly]),
  });
  check(
    `${tag} Regular includes Aff Raw`,
    namesOf(regularWeekly).includes(regularOnly),
    true,
  );
  check(
    `${tag} Regular includes listed-active Aff Raw`,
    namesOf(regularWeekly).includes(listedActive),
    true,
  );
  check(
    `${tag} Regular does not steal Promo leftover without Promo Ended`,
    namesOf(regularWeekly).includes(promoOnly),
    false,
  );
  check(
    `${tag} Regular Aff Raw AP`,
    Number(regularWeekly.find((r) => r[iUser] === regularOnly)?.[cols.indexOf("AP(TO>0)")]),
    3,
  );

  console.log(`\n=== ${tag} Promo weekly roster ===`);
  const promoWeekly = computeWeeklyDetail({
    week: "2026W41",
    marketId: promoId,
    sources: { "aff-raw-upload": [affRawRow(promoOnly, 4, 200)] },
    prevWeekDetail: [detailRow(promoOnly, -777), detailRow(leftover, -321)],
    prevPartnerWeekDetail: [detailRow(regularOnly, -50)],
    partnerCurrentUsernames: new Set([regularOnly, listedActive]),
  });
  check(
    `${tag} Promo includes Aff Raw`,
    namesOf(promoWeekly).includes(promoOnly),
    true,
  );
  check(
    `${tag} Promo keeps leftover NCF not on Regular`,
    namesOf(promoWeekly).includes(leftover),
    true,
  );
  check(
    `${tag} Promo leftover Last NCF`,
    Number(promoWeekly.find((r) => r[iUser] === leftover)?.[iLast]),
    -321,
  );
  check(
    `${tag} Promo does not steal Regular Aff Raw`,
    namesOf(promoWeekly).includes(regularOnly),
    false,
  );

  console.log(`\n=== ${tag} Promo Ended transfer ===`);
  const regularAfter = computeWeeklyDetail({
    week: "2026W41",
    marketId: regularId,
    sources: {
      "aff-raw-upload": [
        affRawRow(regularOnly, 3, 500),
        affRawRow(listedActive, 2, 800),
      ],
    },
    prevWeekDetail: [detailRow(regularOnly, -50)],
    prevPartnerWeekDetail: [
      detailRow(zeroTo, -1200),
      detailRow(zeroNcf, 0),
      detailRow(listedActive, -88),
      detailRow(stillPromo, -400),
      detailRow(leftover, -321),
      detailRow(skipped, -999),
    ],
    partnerCurrentUsernames: new Set([promoOnly, stillPromo]),
    transferInUsernames: [zeroTo, zeroNcf, listedActive, stillPromo],
    siblingAffRawUsernames: new Set([stillPromo]),
  });
  const afterNames = namesOf(regularAfter);
  check(`${tag} Regular gets zero-TO transfer`, afterNames.includes(zeroTo), true);
  check(`${tag} Regular gets NCF-0 transfer`, afterNames.includes(zeroNcf), true);
  check(`${tag} Regular keeps listed Aff Raw`, afterNames.includes(listedActive), true);
  check(
    `${tag} Regular skips transfer still on Promo Aff Raw`,
    afterNames.includes(stillPromo),
    false,
  );
  check(
    `${tag} Regular does not take unlisted Promo leftover`,
    afterNames.includes(skipped),
    false,
  );
  check(
    `${tag} zero-TO Last NCF from Promo`,
    Number(regularAfter.find((r) => r[iUser] === zeroTo)?.[iLast]),
    -1200,
  );
  check(
    `${tag} zero-TO Next NCF still carries`,
    Number(regularAfter.find((r) => r[iUser] === zeroTo)?.[iNext]),
    -1200,
  );
  check(
    `${tag} listed Aff Raw Last NCF from Promo`,
    Number(regularAfter.find((r) => r[iUser] === listedActive)?.[iLast]),
    -88,
  );
  check(
    `${tag} zero-TO AP is 0`,
    Number(regularAfter.find((r) => r[iUser] === zeroTo)?.[cols.indexOf("AP(TO>0)")]),
    0,
  );

  const promoAfterDrop = computeWeeklyDetail({
    week: "2026W41",
    marketId: promoId,
    sources: { "aff-raw-upload": [affRawRow(promoOnly, 4, 200), affRawRow(stillPromo, 1, 50)] },
    prevWeekDetail: [
      detailRow(zeroTo, -1200),
      detailRow(zeroNcf, 0),
      detailRow(stillPromo, -400),
      detailRow(leftover, -321),
      detailRow(skipped, -999),
    ],
    partnerCurrentUsernames: new Set(
      afterNames
        .filter((name) => name !== stillPromo)
        .map((name) => name.toLowerCase()),
    ),
  });
  const promoAfterNames = namesOf(promoAfterDrop);
  check(`${tag} Promo keeps own Aff Raw`, promoAfterNames.includes(promoOnly), true);
  check(`${tag} Promo keeps still-Promo Aff Raw`, promoAfterNames.includes(stillPromo), true);
  check(`${tag} Promo drops zero-TO transfer leftover`, promoAfterNames.includes(zeroTo), false);
  check(`${tag} Promo drops NCF-0 transfer leftover`, promoAfterNames.includes(zeroNcf), false);
  check(`${tag} Promo keeps unlisted leftover NCF`, promoAfterNames.includes(skipped), true);

  const droppedPromo = dropUsersFromWeekDetail(
    [detailRow(zeroTo, -1200), detailRow(stillPromo, -400), detailRow(promoOnly, -1)],
    new Set([zeroTo.toLowerCase(), zeroNcf.toLowerCase()]),
    promoId,
  );
  check(`${tag} dropUsers removes transferred`, namesOf(droppedPromo).includes(zeroTo), false);
  check(`${tag} dropUsers keeps still-Promo`, namesOf(droppedPromo).includes(stillPromo), true);

  const noSheet = computeWeeklyDetail({
    week: "2026W41",
    marketId: regularId,
    sources: { "aff-raw-upload": [] },
    prevPartnerWeekDetail: [detailRow(zeroTo, -1200)],
  });
  check(
    `${tag} missing Promo Ended sheet stays status quo`,
    namesOf(noSheet).includes(zeroTo),
    false,
  );
}

runPromoEndedSuite("m1-bdt", "m1-bdt-promo");
runPromoEndedSuite("m2-bdt", "m2-bdt-promo");

console.log("\n=== Promo Ended import week detection ===");
const endedColumns = TAB_COLUMNS["promo-ended"];
check("promo-ended columns Transfer Week first", endedColumns[0], "Transfer Week");
const endedRows = [
  ["2026W41", "honor750", "2026W40"],
  ["2026W41", "hasan2512", "2026W40"],
  ["2026W42", "later_aff", "2026W41"],
];
const splitEnded = splitRowsByWeek(
  "promo-ended",
  endedRows,
  ["2026W41", "2026W42"],
  "2026W41",
  endedColumns,
);
check("split Promo Ended W41 count", splitEnded.get("2026W41")?.length ?? 0, 2);
check("split Promo Ended W42 count", splitEnded.get("2026W42")?.length ?? 0, 1);

const importedWithAffRaw: ImportedSources = {
  detectedSheets: [
    { sheetName: "Aff Raw", tabId: "aff-raw-upload" },
    { sheetName: "Promo Ended", tabId: "promo-ended" },
  ],
  affSuAll: [],
  sourceColumns: {
    "aff-raw-upload": TAB_COLUMNS["aff-raw-upload"],
    "promo-ended": endedColumns,
  },
  "aff-raw-upload": [affRawRow("someone", 1, 10)],
  "promo-ended": endedRows,
};
check(
  "primary week from Aff Raw not Promo Ended",
  pickPrimaryWeekFromImported(importedWithAffRaw, "2026W40"),
  "2026W41",
);

const importedEndedOnly: ImportedSources = {
  detectedSheets: [{ sheetName: "Promo Ended", tabId: "promo-ended" }],
  affSuAll: [],
  sourceColumns: { "promo-ended": endedColumns },
  "promo-ended": endedRows,
};
check(
  "primary week from Promo Ended when only sheet",
  pickPrimaryWeekFromImported(importedEndedOnly, "2026W40"),
  "2026W41",
);

const endedW39 = parsePromoEndedRows([
  ["2026W41", "old_ncf_aff", "2026W39"],
]);
check("non-adjacent Promo Ended week kept", endedW39[0]?.promoEndedWeek, "2026W39");
const regularFromW39 = computeWeeklyDetail({
  week: "2026W41",
  marketId: "m1-bdt",
  sources: { "aff-raw-upload": [] },
  prevWeekDetail: [],
  prevPartnerWeekDetail: [detailRow("old_ncf_aff", -555)],
  transferInUsernames: ["old_ncf_aff"],
});
check(
  "NCF from non-adjacent Promo Ended week",
  Number(regularFromW39.find((r) => r[iUser] === "old_ncf_aff")?.[iLast]),
  -555,
);

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nAll checks passed");
