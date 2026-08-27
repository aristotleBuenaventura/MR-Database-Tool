export function clearReportCache(): void {
  cache.clear();
  inflight.clear();
}

export type CachedTabData = {
  rows: string[][];
  fileName: string;
  location: string;
  columns?: string[];
  categoryRows?: Record<string, string[][]>;
};

const cache = new Map<string, CachedTabData>();
const inflight = new Map<string, Promise<CachedTabData>>();

export function cacheKey(
  marketId: string,
  week: string,
  tabId: string,
  category = "",
): string {
  return `${marketId}::${week}::${tabId}::${category}`;
}

export function getCachedReport(key: string): CachedTabData | undefined {
  return cache.get(key);
}

export function setCachedReport(key: string, data: CachedTabData): void {
  cache.set(key, data);
}

export function updateCachedRows(
  key: string,
  rows: string[][],
  meta?: Partial<Pick<CachedTabData, "fileName" | "location">>,
): void {
  const current = cache.get(key) ?? {
    rows: [],
    fileName: "",
    location: "",
  };
  cache.set(key, {
    ...current,
    rows,
    fileName: meta?.fileName ?? current.fileName,
    location: meta?.location ?? current.location,
  });
}

export function updateCachedDatabaseCategory(
  key: string,
  category: string,
  rows: string[][],
  meta?: Partial<Pick<CachedTabData, "fileName" | "location">>,
): void {
  const current = cache.get(key) ?? {
    rows: [],
    fileName: "",
    location: "",
    categoryRows: {},
  };
  cache.set(key, {
    ...current,
    fileName: meta?.fileName ?? current.fileName,
    location: meta?.location ?? current.location,
    categoryRows: {
      ...(current.categoryRows ?? {}),
      [category]: rows,
    },
  });
}

export async function loadCached<T extends CachedTabData>(
  key: string,
  loader: () => Promise<T>,
): Promise<T> {
  const existing = cache.get(key) as T | undefined;
  if (existing) return existing;

  const pending = inflight.get(key) as Promise<T> | undefined;
  if (pending) return pending;

  const promise = loader()
    .then((data) => {
      cache.set(key, data);
      inflight.delete(key);
      return data;
    })
    .catch((error) => {
      inflight.delete(key);
      throw error;
    });

  inflight.set(key, promise);
  return promise;
}
