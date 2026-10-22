import { createRequire } from "node:module";
import {
  computeCommPct,
  commissionApValue,
  computeFinalNet,
  computeWeeklyDetail,
  computeWeeklyKpi,
} from "../src/lib/weeklyCompute.ts";
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

function overlap(a: Set<string>, b: Set<string>): string[] {
  return [...a].filter((u) => b.has(u));
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

async function loadAll(conn: Awaited<ReturnType<typeof mariadb.createConnection>>) {
  const raw = await conn.query(
    `SELECT market_id, week, tab_id, category, location, file_name, columns, \`rows\`
     FROM report_datasets
     WHERE market_id IN ('m2-bdt','m2-bdt-promo')`,
  );
  const map = new Map<string, Dataset>();
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
    map.set(`${ds.market_id}|${ds.week}|${ds.tab_id}|${ds.category}`, ds);
  }
  return map;
}

function get(
  map: Map<string, Dataset>,
  market: string,
  week: string,
  tab: string,
  category = "",
): Dataset | null {
  return map.get(`${market}|${week}|${tab}|${category}`) ?? null;
}

function detailStats(label: string, ds: Dataset | null, marketId: string) {
  console.log(`\n=== ${label} ===`);
  if (!ds) {
    console.log("MISSING");
    return {
      users: new Set<string>(),
      nextNcf: new Map<string, number>(),
      lastNcf: new Map<string, number>(),
      paid: 0,
      commMismatch: 0,
      fnDrift: 0,
      nextDrift: 0,
    };
  }
  const h = ds.columns;
  const iUser = colIndex(h, "Affiliate Username");
  const iComm = colIndex(h, "Comm %");
  const iAp = colIndex(h, "AP(TO>0)", "AP (TO>0)");
  const iApq = colIndex(h, "AP Qualified (TO>3000)", "AP Qualified (TO > 3000)");
  const iFn = colIndex(h, "FINAL NET");
  const iNp = colIndex(h, "Net Profit");
  const iLast = colIndex(h, "Last Week Negative Carry Over");
  const iNext = colIndex(h, "Next Week Negative Carry Over");
  const iStatus = colIndex(h, "Status");
  const iFinal = colIndex(h, "Final Commission");
  const profile = defaultCommissionProfile(marketId);
  let commMismatch = 0;
  let fnDrift = 0;
  let nextDrift = 0;
  let paid = 0;
  let paidAmt = 0;
  const nextNcf = new Map<string, number>();
  const lastNcf = new Map<string, number>();
  const uniqueComm = new Set<string>();
  let maxApq = 0;
  for (const row of ds.rows) {
    const user = String(row[iUser] ?? "").trim().toLowerCase();
    if (!user) continue;
    const last = num(row[iLast]);
    const next = num(row[iNext]);
    const fn = num(row[iFn]);
    const np = num(row[iNp]);
    const ap = num(row[iAp]);
    const apq = num(row[iApq]);
    lastNcf.set(user, last);
    nextNcf.set(user, next);
    maxApq = Math.max(maxApq, apq);
    const comm = String(row[iComm] ?? "").trim();
    if (comm) uniqueComm.add(comm);
    const used = commissionApValue(ap, apq, marketId, profile);
    const expected = pctLabel(computeCommPct(used, fn, marketId, profile));
    const actual = actualCommPct(comm);
    if (actual != null && actual !== expected) {
      commMismatch += 1;
      if (commMismatch <= 4) {
        console.log("  COMM", user, { actual, expected, ap, apq, fn });
      }
    }
    if (Math.abs(fn - computeFinalNet(last, np)) > 0.05) {
      fnDrift += 1;
      if (fnDrift <= 3) console.log("  FN", user, { fn, last, np });
    }
    const expectedNext = fn < 0 ? fn : 0;
    if (Math.abs(next - expectedNext) > 0.05) {
      nextDrift += 1;
      if (nextDrift <= 3) console.log("  NEXT", user, { next, expectedNext, fn });
    }
    if (String(row[iStatus] ?? "").trim().toLowerCase() === "paid") {
      paid += 1;
      paidAmt += num(row[iFinal]);
    }
  }
  console.log({
    file: ds.file_name,
    location: ds.location,
    rows: ds.rows.length,
    users: usersOf(ds.rows, h).size,
    uniqueComm: [...uniqueComm].slice(0, 8),
    maxApq,
    commMismatch,
    fnDrift,
    nextDrift,
    paidRows: paid,
    paidFinalSum: Math.round(paidAmt * 100) / 100,
  });
  return {
    users: usersOf(ds.rows, h),
    nextNcf,
    lastNcf,
    paid,
    commMismatch,
    fnDrift,
    nextDrift,
  };
}

function compareSets(label: string, stored: Set<string>, computed: Set<string>) {
  const missing = [...computed].filter((u) => !stored.has(u));
  const extra = [...stored].filter((u) => !computed.has(u));
  console.log(
    `${label}: stored=${stored.size} computed=${computed.size} missingInStored=${missing.length} extraInStored=${extra.length}`,
  );
  if (missing.length) console.log("  missing sample", missing.slice(0, 6));
  if (extra.length) console.log("  extra sample", extra.slice(0, 6));
  return { missing, extra };
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
    const map = await loadAll(conn);
    console.log("loaded datasets", map.size);

    const reg40 = get(map, "m2-bdt", "2026W40", "week-detail", "base");
    const promo40 = get(map, "m2-bdt-promo", "2026W40", "week-detail", "base");
    const reg41 = get(map, "m2-bdt", "2026W41", "week-detail");
    const promo41 = get(map, "m2-bdt-promo", "2026W41", "week-detail");
    const regAff = get(map, "m2-bdt", "2026W41", "aff-raw-upload");
    const promoAff = get(map, "m2-bdt-promo", "2026W41", "aff-raw-upload");
    const regPlayer = get(map, "m2-bdt", "2026W41", "player-raw-upload");
    const promoPlayer = get(map, "m2-bdt-promo", "2026W41", "player-raw-upload");
    const regSys = get(map, "m2-bdt", "2026W41", "system-comm-raw");
    const promoSys = get(map, "m2-bdt-promo", "2026W41", "system-comm-raw");
    const regPaid = get(map, "m2-bdt", "2026W41", "paid-comm");
    const promoPaid = get(map, "m2-bdt-promo", "2026W41", "paid-comm");
    const summary = get(map, "m2-bdt", "2026W41", "weekly-summary");
    const promoSummary = get(map, "m2-bdt-promo", "2026W41", "weekly-summary");
    const promoBiz = get(map, "m2-bdt-promo", "2026W41", "business-raw");

    const sReg40 = detailStats("Regular W40 base", reg40, "m2-bdt");
    const sPromo40 = detailStats("Promo W40 base", promo40, "m2-bdt-promo");
    const sReg41 = detailStats("Regular W41 stored", reg41, "m2-bdt");
    const sPromo41 = detailStats("Promo W41 stored", promo41, "m2-bdt-promo");

    const regAffUsers = usersOf(regAff?.rows ?? [], regAff?.columns ?? []);
    const promoAffUsers = usersOf(promoAff?.rows ?? [], promoAff?.columns ?? []);
    const regSysUsers = usersOf(regSys?.rows ?? [], regSys?.columns ?? []);
    const promoSysUsers = usersOf(promoSys?.rows ?? [], promoSys?.columns ?? []);

    console.log("\n=== Roster disjoint ===");
    const affOverlap = overlap(regAffUsers, promoAffUsers);
    const detailOverlap = overlap(sReg41.users, sPromo41.users);
    const baseOverlap = overlap(sReg40.users, sPromo40.users);
    console.log("W40 base overlap", baseOverlap.length);
    console.log("W41 Aff Raw overlap", affOverlap.length, affOverlap.slice(0, 8));
    console.log("W41 Week Detail overlap", detailOverlap.length, detailOverlap.slice(0, 8));
    console.log("W41 Regular Aff Raw", regAffUsers.size, "Promo Aff Raw", promoAffUsers.size);
    console.log(
      "W41 Regular System Comm",
      regSysUsers.size,
      "Promo System Comm",
      promoSysUsers.size,
      "overlap",
      overlap(regSysUsers, promoSysUsers).length,
    );

    const sysSame =
      regSysUsers.size > 0 &&
      promoSysUsers.size === regSysUsers.size &&
      overlap(regSysUsers, promoSysUsers).length === regSysUsers.size;
    console.log("Promo System Comm is a copy of Regular:", sysSame);

    const promoSysNotInPromoAff = [...promoSysUsers].filter((u) => !promoAffUsers.has(u));
    console.log(
      "Promo System Comm users NOT in Promo Aff Raw:",
      promoSysNotInPromoAff.length,
    );
    const stolen = [...regAffUsers].filter((u) => sPromo41.users.has(u));
    const regularAffOnRegularWd = [...regAffUsers].filter((u) => sReg41.users.has(u));
    console.log(
      "Regular Aff Raw users on Regular WD:",
      regularAffOnRegularWd.length,
      "/",
      regAffUsers.size,
    );
    console.log("Regular Aff Raw users stolen onto Promo WD:", stolen.length, stolen.slice(0, 8));

    console.log("\n=== Movers ===");
    const promoToReg = [...regAffUsers].filter((u) => sPromo40.users.has(u));
    const regToPromo = [...promoAffUsers].filter((u) => sReg40.users.has(u));
    console.log("Promo W40 → Regular W41 Aff Raw", promoToReg.length);
    console.log("Regular W40 → Promo W41 Aff Raw", regToPromo.length);
    let ncfFollowOk = 0;
    let ncfFollowBad = 0;
    for (const u of promoToReg) {
      const expected = sPromo40.nextNcf.get(u) ?? 0;
      const actual = sReg41.lastNcf.get(u);
      if (actual == null) {
        ncfFollowBad += 1;
        if (ncfFollowBad <= 5) console.log("  missing on Regular WD", u, "expected last", expected);
        continue;
      }
      if (Math.abs(actual - expected) < 0.05) ncfFollowOk += 1;
      else {
        ncfFollowBad += 1;
        if (ncfFollowBad <= 5) {
          console.log("  NCF mismatch", u, { expected, actual });
        }
      }
    }
    for (const u of regToPromo) {
      const expected = sReg40.nextNcf.get(u) ?? 0;
      const actual = sPromo41.lastNcf.get(u);
      if (actual == null) {
        ncfFollowBad += 1;
        continue;
      }
      if (Math.abs(actual - expected) < 0.05) ncfFollowOk += 1;
      else {
        ncfFollowBad += 1;
        if (ncfFollowBad <= 5) console.log("  NCF mismatch", u, { expected, actual });
      }
    }
    console.log("mover NCF follow ok", ncfFollowOk, "bad", ncfFollowBad);

    console.log("\n=== Recompute W41 vs stored ===");
    const recomputedPromo = computeWeeklyDetail({
      week: "2026W41",
      marketId: "m2-bdt-promo",
      sources: {
        "aff-raw-upload": promoAff?.rows ?? [],
        "player-raw-upload": promoPlayer?.rows ?? [],
        "system-comm-raw": promoSys?.rows ?? [],
      },
      prevWeekDetail: promo40?.rows ?? [],
      prevPartnerWeekDetail: reg40?.rows ?? [],
      partnerCurrentUsernames: sReg41.users,
      sourceColumns: {
        "aff-raw-upload": promoAff?.columns,
        "player-raw-upload": promoPlayer?.columns,
      },
    });
    const recomputedReg = computeWeeklyDetail({
      week: "2026W41",
      marketId: "m2-bdt",
      sources: {
        "aff-raw-upload": regAff?.rows ?? [],
        "player-raw-upload": regPlayer?.rows ?? [],
        "system-comm-raw": regSys?.rows ?? [],
      },
      prevWeekDetail: reg40?.rows ?? [],
      prevPartnerWeekDetail: promo40?.rows ?? [],
      partnerCurrentUsernames: sPromo41.users,
      sourceColumns: {
        "aff-raw-upload": regAff?.columns,
        "player-raw-upload": regPlayer?.columns,
      },
    });
    const promoComputedUsers = usersOf(recomputedPromo, [
      "Week",
      "Affiliate Username",
    ]);
    // recomputed rows use engine columns; username is col 1
    const promoCompSet = new Set(
      recomputedPromo.map((r) => String(r[1] ?? "").trim().toLowerCase()).filter(Boolean),
    );
    const regCompSet = new Set(
      recomputedReg.map((r) => String(r[1] ?? "").trim().toLowerCase()).filter(Boolean),
    );
    compareSets("Promo W41 vs recompute (with uploaded System Comm)", sPromo41.users, promoCompSet);
    compareSets("Regular W41 vs recompute (after partner drop set)", sReg41.users, regCompSet);

    const promoClean = computeWeeklyDetail({
      week: "2026W41",
      marketId: "m2-bdt-promo",
      sources: {
        "aff-raw-upload": promoAff?.rows ?? [],
        "player-raw-upload": promoPlayer?.rows ?? [],
        "system-comm-raw": [],
      },
      prevWeekDetail: promo40?.rows ?? [],
      prevPartnerWeekDetail: reg40?.rows ?? [],
      partnerCurrentUsernames: new Set([...regAffUsers, ...sReg41.users]),
      sourceColumns: {
        "aff-raw-upload": promoAff?.columns,
        "player-raw-upload": promoPlayer?.columns,
      },
    });
    console.log(
      "Promo W41 recompute WITHOUT System Comm rows:",
      promoClean.length,
      "(stored",
      promo41?.rows.length ?? 0,
      ")",
    );

    const promoFixed = computeWeeklyDetail({
      week: "2026W41",
      marketId: "m2-bdt-promo",
      sources: {
        "aff-raw-upload": promoAff?.rows ?? [],
        "player-raw-upload": promoPlayer?.rows ?? [],
        "system-comm-raw": promoSys?.rows ?? [],
      },
      prevWeekDetail: promo40?.rows ?? [],
      prevPartnerWeekDetail: reg40?.rows ?? [],
      partnerCurrentUsernames: new Set([...regAffUsers, ...sReg40.users]),
      sourceColumns: {
        "aff-raw-upload": promoAff?.columns,
        "player-raw-upload": promoPlayer?.columns,
      },
    });
    const promoFixedUsers = new Set(
      promoFixed.map((r) => String(r[1] ?? "").trim().toLowerCase()).filter(Boolean),
    );
    const stolenAfterFix = [...regAffUsers].filter((u) => promoFixedUsers.has(u));
    console.log(
      "Promo W41 AFTER skip-sibling-system-comm:",
      promoFixed.length,
      "stolen Regular Aff Raw:",
      stolenAfterFix.length,
    );

    const regFixed = computeWeeklyDetail({
      week: "2026W41",
      marketId: "m2-bdt",
      sources: {
        "aff-raw-upload": regAff?.rows ?? [],
        "player-raw-upload": regPlayer?.rows ?? [],
        "system-comm-raw": regSys?.rows ?? [],
      },
      prevWeekDetail: reg40?.rows ?? [],
      prevPartnerWeekDetail: promo40?.rows ?? [],
      partnerCurrentUsernames: promoFixedUsers,
      sourceColumns: {
        "aff-raw-upload": regAff?.columns,
        "player-raw-upload": regPlayer?.columns,
      },
    });
    const regFixedUsers = new Set(
      regFixed.map((r) => String(r[1] ?? "").trim().toLowerCase()).filter(Boolean),
    );
    const statusIdx = 2;
    const paidFixed = regFixed.filter(
      (r) => String(r[statusIdx] ?? "").trim().toLowerCase() === "paid",
    ).length;
    console.log(
      "Regular W41 AFTER fix recompute:",
      regFixed.length,
      "aff raw on WD",
      [...regAffUsers].filter((u) => regFixedUsers.has(u)).length,
      "/",
      regAffUsers.size,
      "paid rows",
      paidFixed,
    );

    console.log("\n=== Paid Comm / Weekly Summary ===");
    console.log("Regular paid-comm rows", regPaid?.rows.length ?? 0, "file", regPaid?.file_name);
    console.log("Promo paid-comm rows", promoPaid?.rows.length ?? 0, "file", promoPaid?.file_name);
    const paidCols = promoPaid?.columns ?? ["Month", "Affiliate Username", "Status", "Adjustment", "Final Comm"];
    const iFinalPaid = colIndex(paidCols, "Final Comm", "Final Commission");
    const promoPaidSum = (promoPaid?.rows ?? []).reduce((s, r) => s + num(r[iFinalPaid]), 0);
    const regPaidSum = (regPaid?.rows ?? []).reduce((s, r) => s + num(r[iFinalPaid]), 0);
    console.log("Regular paid sum", Math.round(regPaidSum * 100) / 100);
    console.log("Promo paid sum", Math.round(promoPaidSum * 100) / 100);
    console.log("Promo has weekly-summary dataset:", Boolean(promoSummary));
    console.log("Promo has business-raw dataset:", Boolean(promoBiz));
    if (summary) {
      const h = summary.columns;
      const iWeek = colIndex(h, "Week", "Month");
      const iComm = colIndex(h, "Commission");
      const row =
        summary.rows.find(
          (r) => String(r[iWeek] ?? "").trim().toUpperCase() === "2026W41",
        ) ?? summary.rows[0];
      const storedComm = num(row?.[iComm]);
      console.log("Weekly Summary file", summary.file_name, "rows", summary.rows.length);
      console.log("Weekly Summary Commission cell", storedComm);
      console.log("Regular+Promo paid sums", Math.round((regPaidSum + promoPaidSum) * 100) / 100);
      const kpi = computeWeeklyKpi({
        week: "2026W41",
        sources: {
          "aff-raw-upload": [...(regAff?.rows ?? []), ...(promoAff?.rows ?? [])],
        },
        paidComm: [...(regPaid?.rows ?? []), ...(promoPaid?.rows ?? [])],
        weekDetail: reg41?.rows ?? [],
      });
      const kpiCols = [
        "Week",
        "New Sign Up",
        "Total Aff",
        "Active Affiliates >5 Player",
        "Active Affiliates <5 Players",
        "Dormant Aff",
        "Active Players",
        "Deposit",
        "Total Turnover",
      ];
      // Commission is toward the end of WEEKLY_KPI_COLUMNS; print the kpi week + last few
      console.log("Recomputed KPI week", kpi[0], "commission-ish last values", kpi.slice(-6));
    }

    console.log("\n=== Issues ===");
    if (detailOverlap.length) {
      console.log(
        "FAIL Week Detail Regular/Promo share",
        detailOverlap.length,
        "usernames",
      );
    } else {
      console.log("OK Week Detail Regular/Promo disjoint");
    }
    if (affOverlap.length) console.log("FAIL Aff Raw overlap", affOverlap.length);
    else console.log("OK Aff Raw disjoint");
    if (sReg41.commMismatch === 0 && sPromo41.commMismatch === 0) {
      console.log("OK stored Comm % matches engine");
    } else {
      console.log(
        "FAIL Comm % mismatches Regular",
        sReg41.commMismatch,
        "Promo",
        sPromo41.commMismatch,
      );
    }
    if (sReg41.fnDrift === 0 && sPromo41.fnDrift === 0 && sReg41.nextDrift === 0 && sPromo41.nextDrift === 0) {
      console.log("OK stored NCF formulas");
    } else {
      console.log("FAIL NCF drifts", {
        regFn: sReg41.fnDrift,
        promoFn: sPromo41.fnDrift,
        regNext: sReg41.nextDrift,
        promoNext: sPromo41.nextDrift,
      });
    }
    if ((regPaid?.rows.length ?? 0) === 0) {
      console.log("FAIL Regular W41 Paid Comm is empty after Promo upload");
    }
    if (sysSame) {
      console.log(
        "WARN Promo source System Comm matches Regular — Promo Week Detail pulled Regular affiliates",
      );
    }
    if (promoSysNotInPromoAff.length > 50) {
      console.log(
        "WARN",
        promoSysNotInPromoAff.length,
        "Promo System Comm names are not Promo Aff Raw affiliates",
      );
    }
  } finally {
    await conn.end();
  }
}

await main();
