import { createRequire } from "node:module";
import {
  computeCommPct,
  commissionApValue,
  computeFinalNet,
  computeWeeklyDetail,
  parsePromoEndedRows,
  promoEndedRecordsForWeek,
  usernamesFromAffRaw,
} from "../src/lib/weeklyCompute.ts";
import { previousWeekCode } from "../src/lib/weeklyImport.ts";
import { defaultCommissionProfile } from "../src/lib/commissionSettings.ts";

const require = createRequire(
  "c:\\Users\\aris2\\Documents\\MR-Database-Tool\\backend\\package.json",
);
const mariadb = require("mariadb") as {
  createConnection: (opts: Record<string, unknown>) => Promise<{
    query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
    end: () => Promise<void>;
  }>;
};

type Dataset = {
  market_id: string;
  week: string;
  tab_id: string;
  category: string;
  location: string | null;
  file_name: string | null;
  columns: string[];
  rows: string[][];
};

const BRANDS = [
  { label: "M1", regular: "m1-bdt", promo: "m1-bdt-promo" },
  { label: "M2", regular: "m2-bdt", promo: "m2-bdt-promo" },
] as const;

let failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = Object.is(actual, expected) || actual === expected;
  if (!ok) failed += 1;
  console.log(
    `${ok ? "OK  " : "FAIL"} ${label}: ${JSON.stringify(actual)} (expected ${JSON.stringify(expected)})`,
  );
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

function num(v: unknown): number {
  const raw = String(v ?? "").replace(/,/g, "").replace(/%/g, "").trim();
  if (!raw) return 0;
  const paren = /^\(\s*([\d.]+)\s*\)$/.exec(raw);
  if (paren) return -Math.abs(Number(paren[1]));
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function colIndex(header: string[], ...aliases: string[]): number {
  const norm = (s: unknown) =>
    String(s ?? "")
      .toLowerCase()
      .replace(/[\n\r]+/g, " ")
      .replace(/[%&]/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const wanted = aliases.map(norm);
  const exact = header.findIndex((h) => wanted.includes(norm(h)));
  if (exact >= 0) return exact;
  return header.findIndex((h) => wanted.some((w) => norm(h).startsWith(w)));
}

function usersOf(rows: string[][], header: string[], aliases = ["Affiliate Username"]): Set<string> {
  const i = colIndex(header, ...aliases);
  const out = new Set<string>();
  if (i < 0) return out;
  for (const row of rows) {
    const u = String(row[i] ?? "").trim().toLowerCase();
    if (u) out.add(u);
  }
  return out;
}

function pctLabel(rate: number): number {
  return Math.round(rate * 100);
}

function actualCommPct(raw: string): number | null {
  const t = raw.replace(/\s/g, "").replace(/%/g, "");
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return n <= 1 ? Math.round(n * 100) : Math.round(n);
}

function ncfMap(ds: Dataset | null, aliases: string[]): Map<string, number> {
  const out = new Map<string, number>();
  if (!ds) return out;
  const iUser = colIndex(ds.columns, "Affiliate Username");
  const iVal = colIndex(ds.columns, ...aliases);
  if (iUser < 0 || iVal < 0) return out;
  for (const row of ds.rows) {
    const user = String(row[iUser] ?? "").trim().toLowerCase();
    if (user) out.set(user, num(row[iVal]));
  }
  return out;
}

function get(
  map: Map<string, Dataset>,
  market: string,
  week: string,
  tab: string,
): Dataset | null {
  const matches: Dataset[] = [];
  for (const ds of map.values()) {
    if (ds.market_id === market && ds.week === week && ds.tab_id === tab) {
      matches.push(ds);
    }
  }
  return (
    matches.find((ds) => ds.category === "") ??
    matches.find((ds) => ds.category !== "base") ??
    matches[0] ??
    null
  );
}

function formulaHealth(label: string, ds: Dataset | null, marketId: string) {
  if (!ds) {
    console.log(`SKIP ${label}: dataset not in DB`);
    return { users: new Set<string>(), commMismatch: 0, fnDrift: 0, nextDrift: 0 };
  }
  const h = ds.columns;
  const iUser = colIndex(h, "Affiliate Username");
  const iComm = colIndex(h, "Comm %");
  const iAp = colIndex(h, "AP(TO>0)", "AP (TO>0)");
  const iApq = colIndex(h, "AP Qualified (TO>3000)", "AP Qualified (TO > 3000)");
  const iFn = colIndex(h, "FINAL NET");
  const iNp = colIndex(h, "Net Profit");
  const iLast = colIndex(h, "Last Week Negative Carry Over", "Last Month Negative Carry Over");
  const iNext = colIndex(h, "Next Week Negative Carry Over", "Next Month Negative Carry Over");
  const profile = defaultCommissionProfile(marketId);
  let commMismatch = 0;
  let fnDrift = 0;
  let nextDrift = 0;
  for (const row of ds.rows) {
    const user = String(row[iUser] ?? "").trim().toLowerCase();
    if (!user) continue;
    const last = num(row[iLast]);
    const next = num(row[iNext]);
    const fn = num(row[iFn]);
    const np = num(row[iNp]);
    const ap = num(row[iAp]);
    const apq = num(row[iApq]);
    const used = commissionApValue(ap, apq, marketId, profile);
    const expected = pctLabel(computeCommPct(used, fn, marketId, profile));
    const actual = actualCommPct(String(row[iComm] ?? ""));
    if (actual != null && actual !== expected) commMismatch += 1;
    if (Math.abs(fn - computeFinalNet(last, np)) > 0.05) fnDrift += 1;
    const expectedNext = fn < 0 ? fn : 0;
    if (Math.abs(next - expectedNext) > 0.05) nextDrift += 1;
  }
  check(`${label} Comm % mismatches`, commMismatch, 0);
  check(`${label} FINAL NET drift`, fnDrift, 0);
  check(`${label} Next NCF drift`, nextDrift, 0);
  return {
    users: usersOf(ds.rows, h),
    commMismatch,
    fnDrift,
    nextDrift,
  };
}

function sample(names: string[], n = 8): string[] {
  return names.slice(0, n);
}

async function main() {
  const conn = await mariadb.createConnection({
    host: "127.0.0.1",
    port: 3306,
    user: "root",
    password: "password",
    database: "mr_database_tool",
    allowPublicKeyRetrieval: true,
    ssl: false,
  });

  try {
    const marketIds = BRANDS.flatMap((b) => [b.regular, b.promo]);
    const placeholders = marketIds.map(() => "?").join(",");
    const raw = await conn.query(
      `SELECT market_id, week, tab_id, category, location, file_name, columns, \`rows\`
       FROM report_datasets
       WHERE market_id IN (${placeholders})`,
      marketIds,
    );
    const map = new Map<string, Dataset>();
    const weeksByMarket = new Map<string, Set<string>>();
    for (const row of raw) {
      const ds: Dataset = {
        market_id: String(row.market_id),
        week: String(row.week),
        tab_id: String(row.tab_id),
        category: String(row.category ?? ""),
        location: row.location == null ? null : String(row.location),
        file_name: row.file_name == null ? null : String(row.file_name),
        columns: parseJson<string[]>(row.columns, []),
        rows: parseJson<string[][]>(row.rows, []),
      };
      const key = `${ds.market_id}|${ds.week}|${ds.tab_id}|${ds.category}`;
      const existing = map.get(key);
      if (!existing || (existing.category === "base" && ds.category === "")) {
        map.set(key, ds);
      }
      if (!weeksByMarket.has(ds.market_id)) weeksByMarket.set(ds.market_id, new Set());
      weeksByMarket.get(ds.market_id)!.add(ds.week);
    }

    const history = await conn.query(
      `SELECT market_id, label, weeks, created_at
       FROM report_histories
       WHERE market_id IN (${placeholders})
         AND label LIKE '%Promo Ended%'
       ORDER BY created_at DESC
       LIMIT 20`,
      marketIds,
    );

    console.log("\n=== Dataset inventory ===");
    for (const brand of BRANDS) {
      const regWeeks = [...(weeksByMarket.get(brand.regular) ?? [])].sort();
      const promoWeeks = [...(weeksByMarket.get(brand.promo) ?? [])].sort();
      console.log(
        `${brand.label} Regular weeks`,
        regWeeks.length ? regWeeks.join(",") : "(none)",
      );
      console.log(
        `${brand.label} Promo weeks`,
        promoWeeks.length ? promoWeeks.join(",") : "(none)",
      );
    }
    console.log("Promo Ended history rows", history.length);
    for (const row of history.slice(0, 8)) {
      console.log(
        "  ",
        row.market_id,
        row.weeks,
        row.label,
      );
    }

    for (const brand of BRANDS) {
      console.log(`\n========== ${brand.label} Regular / Promo weekly ==========`);
      const endedWeeks = [...map.keys()]
        .filter((key) => key.startsWith(`${brand.promo}|`) && key.includes("|promo-ended|"))
        .map((key) => key.split("|")[1]!)
        .filter((week, i, all) => all.indexOf(week) === i)
        .sort();

      const detailWeeks = [...(weeksByMarket.get(brand.regular) ?? [])]
        .filter((week) => get(map, brand.regular, week, "week-detail"))
        .sort();
      const latestDetail = detailWeeks.at(-1) ?? null;
      const transferWeek = endedWeeks.at(-1) ?? latestDetail;

      if (!latestDetail) {
        console.log(`${brand.label}: no Regular week-detail in DB — engine covered by unit tests only`);
        continue;
      }

      const week = transferWeek ?? latestDetail;
      const prev = previousWeekCode(week);
      const reg = get(map, brand.regular, week, "week-detail");
      const promo = get(map, brand.promo, week, "week-detail");
      const regAff = get(map, brand.regular, week, "aff-raw-upload");
      const promoAff = get(map, brand.promo, week, "aff-raw-upload");
      const ended = get(map, brand.promo, week, "promo-ended");
      const regPrev = prev ? get(map, brand.regular, prev, "week-detail") : null;
      const promoPrev = prev ? get(map, brand.promo, prev, "week-detail") : null;

      console.log({
        week,
        prev,
        regularDetail: reg?.rows.length ?? 0,
        promoDetail: promo?.rows.length ?? 0,
        regularAffRaw: regAff?.rows.length ?? 0,
        promoAffRaw: promoAff?.rows.length ?? 0,
        promoEnded: ended?.rows.length ?? 0,
        promoEndedFile: ended?.file_name ?? null,
      });

      const regHealth = formulaHealth(`${brand.label} Regular ${week}`, reg, brand.regular);
      const promoHealth = formulaHealth(`${brand.label} Promo ${week}`, promo, brand.promo);

      const regAffUsers = usernamesFromAffRaw(
        regAff?.rows ?? [],
        week,
        regAff?.columns,
      );
      const promoAffUsers = usernamesFromAffRaw(
        promoAff?.rows ?? [],
        week,
        promoAff?.columns,
      );
      const affOverlap = [...regAffUsers].filter((u) => promoAffUsers.has(u));
      check(`${brand.label} ${week} Aff Raw overlap`, affOverlap.length, 0);

      const detailOverlap = [...regHealth.users].filter((u) => promoHealth.users.has(u));
      check(`${brand.label} ${week} Week Detail overlap`, detailOverlap.length, 0);
      if (detailOverlap.length) {
        console.log("  overlap sample", sample(detailOverlap));
      }

      const missingRegAff = [...regAffUsers].filter((u) => !regHealth.users.has(u));
      check(
        `${brand.label} ${week} Regular Aff Raw all on Regular WD`,
        missingRegAff.length,
        0,
      );
      if (missingRegAff.length) console.log("  missing Regular Aff Raw", sample(missingRegAff));

      const missingPromoAff = [...promoAffUsers].filter((u) => !promoHealth.users.has(u));
      check(
        `${brand.label} ${week} Promo Aff Raw all on Promo WD`,
        missingPromoAff.length,
        0,
      );
      if (missingPromoAff.length) console.log("  missing Promo Aff Raw", sample(missingPromoAff));

      const stolenToPromo = [...regAffUsers].filter((u) => promoHealth.users.has(u));
      check(`${brand.label} ${week} Regular Aff Raw not stolen to Promo`, stolenToPromo.length, 0);

      if (!ended) {
        console.log(
          `${brand.label} ${week}: no Promo Ended sheet stored — skip transfer checks`,
        );
        continue;
      }

      const records = promoEndedRecordsForWeek(
        parsePromoEndedRows(ended.rows, ended.columns),
        week,
      );
      check(`${brand.label} ${week} Promo Ended parsed rows`, records.length > 0, true);

      const listed = records.map((r) => r.username.trim().toLowerCase()).filter(Boolean);
      const listedSet = new Set(listed);
      const stillPromo = listed.filter((u) => promoAffUsers.has(u));
      const listedOnRegularAff = listed.filter((u) => regAffUsers.has(u));
      const zeroTo = listed.filter(
        (u) => !promoAffUsers.has(u) && !regAffUsers.has(u),
      );

      console.log({
        listed: listed.length,
        stillOnPromoAffRaw: stillPromo.length,
        alsoRegularAffRaw: listedOnRegularAff.length,
        zeroToTransfers: zeroTo.length,
      });

      const missingZeroTo = zeroTo.filter((u) => !regHealth.users.has(u));
      const leftoverZeroTo = zeroTo.filter((u) => promoHealth.users.has(u));
      check(`${brand.label} ${week} zero-TO transferred to Regular`, missingZeroTo.length, 0);
      check(`${brand.label} ${week} zero-TO leftover on Promo`, leftoverZeroTo.length, 0);
      if (missingZeroTo.length) console.log("  missing on Regular", sample(missingZeroTo));
      if (leftoverZeroTo.length) console.log("  leftover on Promo", sample(leftoverZeroTo));

      const missingListedAff = listedOnRegularAff.filter((u) => !regHealth.users.has(u));
      check(
        `${brand.label} ${week} listed+Regular Aff Raw on Regular`,
        missingListedAff.length,
        0,
      );

      const stillPromoOnRegular = stillPromo.filter((u) => regHealth.users.has(u) && !regAffUsers.has(u));
      check(
        `${brand.label} ${week} still-Promo Aff Raw not forced onto Regular`,
        stillPromoOnRegular.length,
        0,
      );

      const lastNcfReg = ncfMap(reg, ["Last Week Negative Carry Over", "Last Month Negative Carry Over"]);
      const nextNcfPromoPrev = ncfMap(promoPrev, [
        "Next Week Negative Carry Over",
        "Next Month Negative Carry Over",
      ]);
      const extraEndedWeeks = new Set(
        records
          .map((r) => r.promoEndedWeek)
          .filter((w) => w && w !== prev),
      );
      const extraNext = new Map<string, number>();
      for (const extraWeek of extraEndedWeeks) {
        const extraDs = get(map, brand.promo, extraWeek, "week-detail");
        for (const [user, value] of ncfMap(extraDs, [
          "Next Week Negative Carry Over",
          "Next Month Negative Carry Over",
        ])) {
          extraNext.set(user, value);
        }
      }

      let ncfOk = 0;
      let ncfBad = 0;
      const ncfSamples: string[] = [];
      for (const u of zeroTo) {
        const record = records.find((r) => r.username.trim().toLowerCase() === u);
        const sourceWeek = record?.promoEndedWeek && record.promoEndedWeek !== prev
          ? record.promoEndedWeek
          : prev;
        const expected =
          (sourceWeek && sourceWeek !== prev
            ? extraNext.get(u)
            : nextNcfPromoPrev.get(u)) ?? 0;
        const actual = lastNcfReg.get(u);
        if (actual == null) {
          ncfBad += 1;
          continue;
        }
        if (Math.abs(actual - expected) < 0.05) {
          ncfOk += 1;
          if (expected !== 0 && ncfSamples.length < 6) ncfSamples.push(u);
        } else {
          ncfBad += 1;
          if (ncfBad <= 5) {
            console.log("  NCF mismatch", u, { expected, actual, sourceWeek });
          }
        }
      }
      check(`${brand.label} ${week} zero-TO NCF mismatches`, ncfBad, 0);
      console.log(`${brand.label} ${week} zero-TO NCF matched`, ncfOk, "/", zeroTo.length);

      const recomputedReg = computeWeeklyDetail({
        week,
        marketId: brand.regular,
        sources: {
          "aff-raw-upload": regAff?.rows ?? [],
          "player-raw-upload": get(map, brand.regular, week, "player-raw-upload")?.rows ?? [],
          "system-comm-raw": get(map, brand.regular, week, "system-comm-raw")?.rows ?? [],
        },
        prevWeekDetail: regPrev?.rows ?? [],
        prevPartnerWeekDetail: [
          ...(promoPrev?.rows ?? []),
          ...[...extraEndedWeeks].flatMap(
            (extraWeek) => get(map, brand.promo, extraWeek, "week-detail")?.rows ?? [],
          ),
        ],
        partnerCurrentUsernames: new Set([
          ...promoAffUsers,
          ...[...promoHealth.users].filter((u) => !listedSet.has(u) || promoAffUsers.has(u)),
        ]),
        transferInUsernames: listed.filter((u) => !promoAffUsers.has(u)),
        siblingAffRawUsernames: promoAffUsers,
        sourceColumns: {
          "aff-raw-upload": regAff?.columns,
          "player-raw-upload": get(map, brand.regular, week, "player-raw-upload")?.columns,
        },
      });
      const recomputeUsers = new Set(
        recomputedReg.map((row) => String(row[1] ?? "").trim().toLowerCase()).filter(Boolean),
      );
      const missingInStored = [...recomputeUsers].filter((u) => !regHealth.users.has(u));
      const transferredMissing = missingInStored.filter((u) => listedSet.has(u));
      check(
        `${brand.label} ${week} recomputed transfers present in stored Regular`,
        transferredMissing.length,
        0,
      );
      if (transferredMissing.length) {
        console.log("  recomputed transfers missing in stored", sample(transferredMissing));
      }

      console.log(`\n--- ${brand.label} names to check (${week}) ---`);
      console.log("zero-TO with NCF:", sample(
        zeroTo.filter((u) => (lastNcfReg.get(u) ?? 0) !== 0).map((u) => `${u} (Last NCF ${lastNcfReg.get(u)})`),
        6,
      ));
      console.log("zero-TO NCF 0:", sample(zeroTo.filter((u) => (lastNcfReg.get(u) ?? 0) === 0), 6));
      console.log("listed + Regular Aff Raw:", sample(listedOnRegularAff, 6));
      if (stillPromo.length) console.log("listed but still Promo Aff Raw:", sample(stillPromo, 6));
    }
  } finally {
    await conn.end();
  }
}

await main();
if (failed > 0) {
  console.error(`\n${failed} live check(s) failed`);
  process.exit(1);
}
console.log("\nAll live checks passed");
