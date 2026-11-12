import { createRequire } from "node:module";
import {
  computeCommPct,
  commissionApValue,
  computeFinalNet,
  computeWeeklyDetail,
  computeWeeklyKpi,
  usernamesFromAffRaw,
} from "../src/lib/weeklyCompute.ts";
import { defaultCommissionProfile } from "../src/lib/commissionSettings.ts";
import { previousWeekCode } from "../src/lib/weeklyImport.ts";
import { weekDetailColumnsForMarket } from "../src/config/reports.ts";

const requireFrontend = createRequire(
  "c:\\Users\\aris2\\Documents\\MR-Database-Tool\\frontend\\package.json",
);
const requireBackend = createRequire(
  "c:\\Users\\aris2\\Documents\\MR-Database-Tool\\backend\\package.json",
);
const XLSX = requireFrontend("xlsx") as typeof import("xlsx");
const mariadb = requireBackend("mariadb") as {
  createConnection: (opts: Record<string, unknown>) => Promise<{
    query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
    end: () => Promise<void>;
  }>;
};

const MARKET = "m1-bdt-monthly";
const MONTH = "202610";
const PREV = "202609";
const BASE_FILE =
  String.raw`c:\Users\aris2\Downloads\Telegram Desktop\M1 BDT Monthly Base File 202609.xlsx`;
const SRC_FILE =
  String.raw`c:\Users\aris2\Downloads\Telegram Desktop\M1 BDT Monthly Online Website Source 202610.xlsx`;

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
      .replace(/[%&']/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const wanted = aliases.map(norm);
  const exact = header.findIndex((h) => wanted.includes(norm(h)));
  if (exact >= 0) return exact;
  return header.findIndex((h) => wanted.some((w) => norm(h).startsWith(w)));
}

function sheetRows(path: string, sheetName?: string) {
  const wb = XLSX.readFile(path, { cellDates: false, raw: false });
  console.log("file", path.split("\\").pop(), "sheets:", wb.SheetNames.join(" | "));
  const name = sheetName ?? wb.SheetNames[0]!;
  const sheet = wb.Sheets[name];
  if (!sheet) throw new Error(`missing sheet ${name}`);
  const matrix = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  });
  const rows = matrix.map((row) =>
    (row ?? []).map((cell) => String(cell ?? "").trim()),
  );
  return { sheetNames: wb.SheetNames, name, rows };
}

function headerAndBody(rows: string[][]) {
  let headerIdx = 0;
  for (let i = 0; i < Math.min(rows.length, 20); i += 1) {
    const joined = rows[i]!.join(" ").toLowerCase();
    if (joined.includes("affiliate username") || joined.includes("month")) {
      headerIdx = i;
      break;
    }
  }
  return {
    columns: rows[headerIdx] ?? [],
    body: rows.slice(headerIdx + 1).filter((r) => r.some((c) => c.trim())),
  };
}

async function loadDb() {
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
    const raw = await conn.query(
      `SELECT market_id, week, tab_id, category, location, file_name, columns, \`rows\`
       FROM report_datasets WHERE market_id=?`,
      [MARKET],
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
      map.set(`${ds.week}|${ds.tab_id}|${ds.category}`, ds);
    }
    const history = await conn.query(
      `SELECT label, weeks, file_name, created_at FROM report_histories
       WHERE market_id=? ORDER BY created_at DESC LIMIT 8`,
      [MARKET],
    );
    return { map, history };
  } finally {
    await conn.end();
  }
}

function get(
  map: Map<string, Dataset>,
  week: string,
  tab: string,
): Dataset | null {
  return (
    map.get(`${week}|${tab}|`) ??
    map.get(`${week}|${tab}|base`) ??
    [...map.values()].find((d) => d.week === week && d.tab_id === tab) ??
    null
  );
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

async function main() {
  console.log("\n=== Excel inventory ===");
  const baseWb = sheetRows(BASE_FILE);
  const srcWb = XLSX.readFile(SRC_FILE, { cellDates: false, raw: false });
  console.log("SRC sheets:", srcWb.SheetNames.join(" | "));

  const { map, history } = await loadDb();
  console.log("\n=== DB datasets ===");
  for (const ds of [...map.values()].sort((a, b) =>
    `${a.week}|${a.tab_id}`.localeCompare(`${b.week}|${b.tab_id}`),
  )) {
    console.log({
      week: ds.week,
      tab: ds.tab_id,
      category: ds.category || "(blank)",
      location: ds.location,
      rows: ds.rows.length,
      file: ds.file_name,
    });
  }
  console.log("history:");
  for (const h of history) {
    console.log(" ", h.created_at, h.weeks, h.label);
  }

  const detail = get(map, MONTH, "week-detail");
  const prevDetail = get(map, PREV, "week-detail");
  const aff = get(map, MONTH, "aff-raw-upload");
  const player = get(map, MONTH, "player-raw-upload");
  const system = get(map, MONTH, "system-comm-raw");
  const paid = get(map, MONTH, "paid-comm");
  const summary = get(map, MONTH, "weekly-summary") ?? get(map, PREV, "weekly-summary");
  const summaryAll = [...map.values()].filter((d) => d.tab_id === "weekly-summary");

  check(`DB has ${MONTH} week-detail`, Boolean(detail && detail.rows.length > 0), true);
  check(`DB has ${PREV} week-detail base`, Boolean(prevDetail && prevDetail.rows.length > 0), true);
  check(`DB has ${MONTH} Aff Raw`, Boolean(aff && aff.rows.length > 0), true);
  check(`previousMonth(${MONTH})`, previousWeekCode(MONTH), PREV);

  if (!detail || !aff) {
    console.error("Missing core datasets — cannot continue formula checks");
    process.exit(1);
  }

  const profile = defaultCommissionProfile(MARKET);
  const h = detail.columns;
  const iUser = colIndex(h, "Affiliate Username");
  const iComm = colIndex(h, "Comm %");
  const iAp = colIndex(h, "AP(TO>0)", "AP (TO>0)");
  const iApq = colIndex(h, "AP Qualified (TO>3000)", "AP Qualified (TO > 3000)");
  const iFn = colIndex(h, "FINAL NET");
  const iNp = colIndex(h, "Net Profit");
  const iLast = colIndex(
    h,
    "Last Month Negative Carry Over",
    "Last Week Negative Carry Over",
  );
  const iNext = colIndex(
    h,
    "Next Month Negative Carry Over",
    "Next Week Negative Carry Over",
  );
  const iStatus = colIndex(h, "Status");
  const iFinal = colIndex(h, "Final Commission");
  const iCalc = colIndex(h, "Calculated Commission");
  const iSys = colIndex(h, "System Commission");
  const iGross = colIndex(h, "Gross Revenue");
  const iDed = colIndex(h, "Deduction");
  const iTpl = colIndex(h, "Total Profit & Loss");

  let commMismatch = 0;
  let fnDrift = 0;
  let nextDrift = 0;
  let paidCount = 0;
  const uniqueComm = new Set<string>();
  const users = new Set<string>();
  const lastNcf = new Map<string, number>();
  const nextNcf = new Map<string, number>();
  const sampleMismatch: string[] = [];

  for (const row of detail.rows) {
    const user = String(row[iUser] ?? "").trim().toLowerCase();
    if (!user) continue;
    users.add(user);
    const last = num(row[iLast]);
    const next = num(row[iNext]);
    const fn = num(row[iFn]);
    const np = num(row[iNp]);
    const ap = num(row[iAp]);
    const apq = num(row[iApq]);
    const gross = num(row[iGross]);
    const ded = num(row[iDed]);
    lastNcf.set(user, last);
    nextNcf.set(user, next);
    const comm = String(row[iComm] ?? "").trim();
    if (comm) uniqueComm.add(comm);
    const used = commissionApValue(ap, apq, MARKET, profile);
    const expected = pctLabel(computeCommPct(used, fn, MARKET, profile));
    const actual = actualCommPct(comm);
    if (actual != null && actual !== expected) {
      commMismatch += 1;
      if (sampleMismatch.length < 6) {
        sampleMismatch.push(`${user} comm actual=${actual} expected=${expected} ap=${ap} apq=${apq} fn=${fn}`);
      }
    }
    if (Math.abs(fn - computeFinalNet(last, np)) > 0.05) {
      fnDrift += 1;
      if (sampleMismatch.length < 10) {
        sampleMismatch.push(`${user} FN drift fn=${fn} last=${last} np=${np}`);
      }
    }
    const expectedNext = fn < 0 ? fn : 0;
    if (Math.abs(next - expectedNext) > 0.05) nextDrift += 1;
    if (String(row[iStatus] ?? "").trim().toLowerCase() === "paid") paidCount += 1;
  }

  console.log("\n=== Stored Month Detail health ===", {
    rows: detail.rows.length,
    users: users.size,
    uniqueComm: [...uniqueComm].slice(0, 10),
    paidRows: paidCount,
    location: detail.location,
    file: detail.file_name,
  });
  check(`${MONTH} Comm % mismatches`, commMismatch, 0);
  check(`${MONTH} FINAL NET drift`, fnDrift, 0);
  check(`${MONTH} Next NCF drift`, nextDrift, 0);
  if (sampleMismatch.length) console.log("samples", sampleMismatch);

  // NCF carry from base prev month
  if (prevDetail) {
    const prevNext = new Map<string, number>();
    const piUser = colIndex(prevDetail.columns, "Affiliate Username");
    const piNext = colIndex(
      prevDetail.columns,
      "Next Month Negative Carry Over",
      "Next Week Negative Carry Over",
    );
    for (const row of prevDetail.rows) {
      const u = String(row[piUser] ?? "").trim().toLowerCase();
      if (u) prevNext.set(u, num(row[piNext]));
    }
    let carryOk = 0;
    let carryBad = 0;
      const carrySamples: string[] = [];
    for (const [u, expected] of prevNext) {
      if (expected === 0) continue;
      const actual = lastNcf.get(u);
      if (actual == null) continue;
      if (Math.abs(actual - expected) < 0.05) {
        carryOk += 1;
        if (carrySamples.length < 5) carrySamples.push(`${u} ${expected}`);
      } else {
        carryBad += 1;
        if (carryBad <= 5) console.log("  NCF carry mismatch", u, { expected, actual });
      }
    }
    const affUsers = usernamesFromAffRaw(aff.rows, MONTH, aff.columns);
    console.log({
      carryOk,
      carryBad,
      affOnDetail: [...affUsers].filter((u) => users.has(u)).length,
      affTotal: affUsers.size,
    });
    check(
      `${MONTH} Aff Raw all on Month Detail`,
      [...affUsers].every((u) => users.has(u)),
      true,
    );
    check(`${MONTH} NCF carry mismatches (nonzero prev)`, carryBad, 0);
    console.log("carry samples", carrySamples);
  }

  console.log("\n=== Recompute vs stored ===");
  const recomputed = computeWeeklyDetail({
    week: MONTH,
    marketId: MARKET,
    sources: {
      "aff-raw-upload": aff.rows,
      "player-raw-upload": player?.rows ?? [],
      "system-comm-raw": system?.rows ?? [],
    },
    prevWeekDetail: prevDetail?.rows ?? [],
    sourceColumns: {
      "aff-raw-upload": aff.columns,
      "player-raw-upload": player?.columns,
    },
    profile,
  });
  const reUsers = new Set(
    recomputed.map((r) => String(r[1] ?? "").trim().toLowerCase()).filter(Boolean),
  );
  const missingInStored = [...reUsers].filter((u) => !users.has(u));
  const extraInStored = [...users].filter((u) => !reUsers.has(u));
  console.log({
    recomputed: recomputed.length,
    stored: detail.rows.length,
    missingInStored: missingInStored.length,
    extraInStored: extraInStored.length,
  });
  if (missingInStored.length) console.log("  missing sample", missingInStored.slice(0, 8));
  if (extraInStored.length) console.log("  extra sample", extraInStored.slice(0, 8));

  const reByUser = new Map<string, string[]>();
  for (const row of recomputed) {
    const u = String(row[1] ?? "").trim().toLowerCase();
    if (u) reByUser.set(u, row);
  }
  const reCols = recomputed[0] ? recomputed[0].length : 0;
  console.log("recompute col count", reCols, "stored col count", detail.columns.length);

  const engineCols = weekDetailColumnsForMarket(MARKET, profile.totalProfitLoss);
  const eFn = engineCols.indexOf("FINAL NET");
  const eLast = engineCols.findIndex((c) =>
    /Last (Month|Week) Negative Carry Over/.test(c),
  );
  const eNext = engineCols.findIndex((c) =>
    /Next (Month|Week) Negative Carry Over/.test(c),
  );
  const eComm = engineCols.indexOf("Comm %");
  const eAp = engineCols.indexOf("AP(TO>0)");

  let fnMis = 0;
  let lastMis = 0;
  let nextMis = 0;
  let commMis = 0;
  let apMis = 0;
  const fieldSamples: string[] = [];
  for (const row of detail.rows) {
    const u = String(row[iUser] ?? "").trim().toLowerCase();
    const re = reByUser.get(u);
    if (!re) continue;
    const pairs: [string, number, number][] = [
      ["FN", num(row[iFn]), num(re[eFn])],
      ["LastNCF", num(row[iLast]), num(re[eLast])],
      ["NextNCF", num(row[iNext]), num(re[eNext])],
      ["AP", num(row[iAp]), num(re[eAp])],
    ];
    for (const [label, a, b] of pairs) {
      if (Math.abs(a - b) > 0.05) {
        if (label === "FN") fnMis += 1;
        if (label === "LastNCF") lastMis += 1;
        if (label === "NextNCF") nextMis += 1;
        if (label === "AP") apMis += 1;
        if (fieldSamples.length < 8) fieldSamples.push(`${u} ${label} stored=${a} re=${b}`);
      }
    }
    const storedComm = actualCommPct(String(row[iComm] ?? ""));
    const reComm = actualCommPct(String(re[eComm] ?? ""));
    if (storedComm != null && reComm != null && storedComm !== reComm) {
      commMis += 1;
      if (fieldSamples.length < 10) fieldSamples.push(`${u} Comm stored=${storedComm} re=${reComm}`);
    }
  }
  check("recompute FINAL NET mismatches", fnMis, 0);
  check("recompute Last NCF mismatches", lastMis, 0);
  check("recompute Next NCF mismatches", nextMis, 0);
  check("recompute Comm % mismatches", commMis, 0);
  check("recompute AP mismatches", apMis, 0);
  if (fieldSamples.length) console.log("field samples", fieldSamples);

  // Paid Comm derived
  if (paid) {
    check("Paid Comm rows match Paid status count", paid.rows.length, paidCount);
  } else {
    console.log("SKIP Paid Comm dataset missing");
  }

  // Weekly/Monthly summary for 202610
  const summaryDs =
    summaryAll.find((d) => d.rows.some((r) => String(r[0] ?? "").toUpperCase() === MONTH)) ??
    summary;
  if (summaryDs) {
    const sh = summaryDs.columns;
    const iWeek = colIndex(sh, "Month", "Week");
    const iNew = colIndex(sh, "New Sign Up");
    const iTotal = colIndex(sh, "Total Aff");
    const iCommSum = colIndex(sh, "Commission");
    const row =
      summaryDs.rows.find((r) => String(r[iWeek] ?? "").trim().toUpperCase() === MONTH) ??
      null;
    console.log("\n=== Monthly Summary row", MONTH, "===");
    if (row) {
      console.log({
        newSignUp: row[iNew],
        totalAff: row[iTotal],
        dormant: row[colIndex(sh, "Dormant Aff")],
        commission: row[iCommSum],
        file: summaryDs.file_name,
      });
      check(`${MONTH} New Sign Up`, num(row[iNew]), 1);
      check(`${MONTH} Total Aff`, num(row[iTotal]), 34391);
      const dormant = num(row[colIndex(sh, "Dormant Aff")]);
      check(`${MONTH} Dormant Aff positive`, dormant > 0, true);
      check(
        `${MONTH} Dormant Aff value`,
        dormant,
        34391 - 1415 - 3036,
      );
      const kpi = computeWeeklyKpi({
        week: MONTH,
        marketId: MARKET,
        sources: {
          "aff-raw-upload": aff.rows,
          "aff-su": get(map, MONTH, "aff-su")?.rows ??
            [...map.values()].find((d) => d.tab_id === "aff-su")?.rows ??
            [],
          "business-raw":
            [...map.values()].find((d) => d.tab_id === "business-raw")?.rows ?? [],
        },
        paidComm: paid?.rows ?? [],
        weekDetail: detail.rows,
        prevTotalAff: 34390,
        sourceColumns: {
          "aff-raw-upload": aff.columns,
        },
      });
      console.log("recomputed KPI snapshot (first 8)", kpi.slice(0, 8));
      check("recompute New Sign Up", num(kpi[1]), 1);
      check("recompute Total Aff", num(kpi[2]), 34391);
    } else {
      console.log("No summary row for", MONTH, "rows", summaryDs.rows.length);
      check(`${MONTH} summary row exists`, false, true);
    }
  }

  // Spot-check a few high AP / high FN names
  console.log("\n=== Spot samples (stored) ===");
  const ranked = detail.rows
    .map((row) => ({
      user: String(row[iUser] ?? "").trim(),
      ap: num(row[iAp]),
      apq: num(row[iApq]),
      fn: num(row[iFn]),
      last: num(row[iLast]),
      next: num(row[iNext]),
      comm: String(row[iComm] ?? "").trim(),
      status: String(row[iStatus] ?? "").trim(),
    }))
    .filter((r) => r.user)
    .sort((a, b) => Math.abs(b.fn) - Math.abs(a.fn));
  for (const r of ranked.slice(0, 8)) {
    console.log(r);
  }
  const withCarry = ranked.filter((r) => r.last !== 0).slice(0, 6);
  console.log("with Last NCF:", withCarry);

  // Compare Excel base sheet NCF sample if possible
  console.log("\n=== Excel base sheet peek ===");
  const baseSheet =
    baseWb.sheetNames.find((n) => /202609|month\s*detail|week/i.test(n)) ??
    baseWb.sheetNames[0]!;
  const baseData = sheetRows(BASE_FILE, baseSheet);
  const baseParsed = headerAndBody(baseData.rows);
  console.log("base sheet", baseSheet, "cols", baseParsed.columns.slice(0, 8), "rows", baseParsed.body.length);

  // Aff Raw from source
  const affSheet =
    srcWb.SheetNames.find((n) => /aff\s*raw/i.test(n)) ?? null;
  if (affSheet) {
    const affMatrix = XLSX.utils.sheet_to_json<(string | number | null)[]>(
      srcWb.Sheets[affSheet]!,
      { header: 1, defval: "", raw: false },
    );
    const affParsed = headerAndBody(
      affMatrix.map((row) => (row ?? []).map((c) => String(c ?? "").trim())),
    );
    const excelAffUsers = new Set<string>();
    const ui = colIndex(affParsed.columns, "Affiliate Username");
    const mi = colIndex(affParsed.columns, "Month", "Week");
    for (const row of affParsed.body) {
      if (mi >= 0 && String(row[mi] ?? "").replace(/\D/g, "").slice(0, 6) !== MONTH) {
        // also accept normalized
        const code = String(row[mi] ?? "").trim().toUpperCase().replace(/[-/_.\s]/g, "");
        if (code !== MONTH && code !== `2026W${MONTH.slice(4)}`) continue;
      }
      const u = String(row[ui] ?? "").trim().toLowerCase();
      if (u) excelAffUsers.add(u);
    }
    const dbAff = usernamesFromAffRaw(aff.rows, MONTH, aff.columns);
    const miss = [...excelAffUsers].filter((u) => !dbAff.has(u));
    const extra = [...dbAff].filter((u) => !excelAffUsers.has(u));
    console.log({
      excelAffSheet: affSheet,
      excelAff: excelAffUsers.size,
      dbAff: dbAff.size,
      missingInDb: miss.length,
      extraInDb: extra.length,
    });
    check("Aff Raw Excel vs DB count close", Math.abs(excelAffUsers.size - dbAff.size) <= 2, true);
    if (miss.length) console.log("  aff missing sample", miss.slice(0, 6));
  }
}

await main();
if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nAll M1 Monthly live checks passed");
