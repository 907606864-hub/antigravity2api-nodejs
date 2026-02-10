function clamp01(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  if (numeric < 0) return 0;
  if (numeric > 1) return 1;
  return numeric;
}

function toFiniteMs(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function average(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sum = values.reduce((acc, current) => acc + current, 0);
  return sum / values.length;
}

/**
 * Aggregate quota data by model across tokens.
 * @param {Array<{id: string, email?: string|null, projectId?: string|null, enable?: boolean, tokenType?: string}>} tokens
 * @param {Object<string, Object<string, {r?: number, t?: string}>>} quotaByTokenId
 * @param {number} nowMs
 * @returns {{
 *   tokenStats: {
 *     totalTokens: number,
 *     includedTokens: number,
 *     withQuotaData: number,
 *     withoutQuotaData: number,
 *     enabledTokens: number,
 *     disabledTokens: number
 *   },
 *   models: Array<{
 *     modelId: string,
 *     tokenCount: number,
 *     exhaustedCount: number,
 *     exhaustedRate: number,
 *     avgRemaining: number,
 *     avgRemainingPercent: number,
 *     avgResetDelayMinutes: number|null,
 *     avgResetDelayMinutesExhausted: number|null,
 *     avgResetMs: number|null,
 *     avgResetMsExhausted: number|null,
 *     earliestResetMs: number|null,
 *     latestResetMs: number|null
 *   }>,
 *   detailsByModel: Object<string, {
 *     tokenCount: number,
 *     exhaustedCount: number,
 *     entries: Array<{
 *       tokenId: string,
 *       tokenType: string,
 *       email: string|null,
 *       projectId: string|null,
 *       enable: boolean,
 *       remaining: number,
 *       remainingPercent: number,
 *       resetTimeRaw: string|null,
 *       resetMs: number|null,
 *       minutesToReset: number|null,
 *       isExhausted: boolean
 *     }>
 *   }>
 * }}
 */
export function summarizeQuotaByModel(tokens, quotaByTokenId, nowMs = Date.now()) {
  const normalizedTokens = Array.isArray(tokens) ? tokens : [];
  const modelMap = new Map();

  let withQuotaData = 0;
  let withoutQuotaData = 0;
  let enabledTokens = 0;
  let disabledTokens = 0;

  for (const token of normalizedTokens) {
    const tokenId = typeof token?.id === 'string' ? token.id : '';
    if (!tokenId) continue;

    const enable = token?.enable !== false;
    if (enable) enabledTokens += 1;
    else disabledTokens += 1;

    const modelQuotas = quotaByTokenId?.[tokenId];
    const modelEntries = modelQuotas && typeof modelQuotas === 'object' ? Object.entries(modelQuotas) : [];

    if (modelEntries.length === 0) {
      withoutQuotaData += 1;
      continue;
    }
    withQuotaData += 1;

    for (const [modelId, quota] of modelEntries) {
      const normalizedModelId = String(modelId || '').trim();
      if (!normalizedModelId) continue;

      if (!modelMap.has(normalizedModelId)) {
        modelMap.set(normalizedModelId, {
          totalRemaining: 0,
          tokenCount: 0,
          exhaustedCount: 0,
          resetMsList: [],
          resetMsExhaustedList: [],
          earliestResetMs: null,
          latestResetMs: null,
          details: []
        });
      }

      const bucket = modelMap.get(normalizedModelId);
      const remaining = clamp01(quota?.r);
      const resetTimeRaw = typeof quota?.t === 'string' ? quota.t : null;
      const resetMs = toFiniteMs(resetTimeRaw);
      const isExhausted = remaining <= 0;
      const minutesToReset = Number.isFinite(resetMs) ? Math.max(0, (resetMs - nowMs) / 60000) : null;

      bucket.totalRemaining += remaining;
      bucket.tokenCount += 1;
      if (isExhausted) bucket.exhaustedCount += 1;

      if (Number.isFinite(resetMs)) {
        bucket.resetMsList.push(resetMs);
        if (isExhausted) bucket.resetMsExhaustedList.push(resetMs);
        bucket.earliestResetMs = bucket.earliestResetMs === null ? resetMs : Math.min(bucket.earliestResetMs, resetMs);
        bucket.latestResetMs = bucket.latestResetMs === null ? resetMs : Math.max(bucket.latestResetMs, resetMs);
      }

      bucket.details.push({
        tokenId,
        tokenType: String(token?.tokenType || token?.source || 'token'),
        email: token?.email || null,
        projectId: token?.projectId || null,
        enable,
        remaining,
        remainingPercent: remaining * 100,
        resetTimeRaw,
        resetMs,
        minutesToReset,
        isExhausted
      });
    }
  }

  const models = [];
  const detailsByModel = {};

  for (const [modelId, bucket] of modelMap.entries()) {
    const avgRemaining = bucket.tokenCount > 0 ? (bucket.totalRemaining / bucket.tokenCount) : 0;
    const exhaustedRate = bucket.tokenCount > 0 ? (bucket.exhaustedCount / bucket.tokenCount) : 0;

    const sortedDetails = [...bucket.details].sort((a, b) => {
      if (a.isExhausted !== b.isExhausted) return a.isExhausted ? -1 : 1;
      if (a.remaining !== b.remaining) return a.remaining - b.remaining;
      const aReset = Number.isFinite(a.resetMs) ? a.resetMs : Number.MAX_SAFE_INTEGER;
      const bReset = Number.isFinite(b.resetMs) ? b.resetMs : Number.MAX_SAFE_INTEGER;
      return aReset - bReset;
    });

    detailsByModel[modelId] = {
      tokenCount: bucket.tokenCount,
      exhaustedCount: bucket.exhaustedCount,
      entries: sortedDetails
    };

    models.push({
      modelId,
      tokenCount: bucket.tokenCount,
      exhaustedCount: bucket.exhaustedCount,
      exhaustedRate,
      avgRemaining,
      avgRemainingPercent: avgRemaining * 100,
      avgResetDelayMinutes: average(bucket.resetMsList.map(ms => Math.max(0, (ms - nowMs) / 60000))),
      avgResetDelayMinutesExhausted: average(bucket.resetMsExhaustedList.map(ms => Math.max(0, (ms - nowMs) / 60000))),
      avgResetMs: average(bucket.resetMsList),
      avgResetMsExhausted: average(bucket.resetMsExhaustedList),
      earliestResetMs: bucket.earliestResetMs,
      latestResetMs: bucket.latestResetMs
    });
  }

  models.sort((a, b) => {
    if (a.exhaustedCount !== b.exhaustedCount) return b.exhaustedCount - a.exhaustedCount;
    if (a.avgRemaining !== b.avgRemaining) return a.avgRemaining - b.avgRemaining;
    if (a.tokenCount !== b.tokenCount) return b.tokenCount - a.tokenCount;
    return a.modelId.localeCompare(b.modelId);
  });

  return {
    tokenStats: {
      totalTokens: normalizedTokens.length,
      includedTokens: normalizedTokens.length,
      withQuotaData,
      withoutQuotaData,
      enabledTokens,
      disabledTokens
    },
    models,
    detailsByModel
  };
}
