/**
 * 测试 429 重试逻辑
 * 测试场景：
 * 1. 额度耗尽（恢复时间 > 60分钟）- 应该禁用模型系列，不重试
 * 2. 短时间速率限制（恢复时间 < 60分钟）- 应该重试
 * 3. 503 容量不足 - 应该重试
 */

// 模拟依赖
const mockConfig = {
  quota: {
    longCooldownThreshold: 60 * 60 * 1000 // 60分钟
  }
};

const mockLogger = {
  warn: (msg) => console.log(`[WARN] ${msg}`),
  info: (msg) => console.log(`[INFO] ${msg}`)
};

const mockTokenCooldownManager = {
  isAvailable: () => true,
  setCooldown: (tokenId, modelId, timestamp) => {
    console.log(`[COOLDOWN] Token ${tokenId} 的 ${modelId} 系列已禁用，恢复时间: ${new Date(timestamp).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
  }
};

const mockQuotaManager = {
  getModelGroupResetTime: () => ({ resetTime: null, hasData: false })
};

const mockModelGroups = {
  getGroupKey: (modelId) => modelId.includes('claude') ? 'claude' : 'gemini'
};

// 创建测试错误
function createQuotaExhaustedError(resetTimeStamp, resetDelaySeconds) {
  const error = new Error('Quota exhausted');
  error.status = 429;
  error.rawBody = JSON.stringify({
    error: {
      code: 429,
      message: `You have exhausted your capacity on this model. Your quota will reset after ${Math.floor(resetDelaySeconds / 3600)}h${Math.floor((resetDelaySeconds % 3600) / 60)}m${resetDelaySeconds % 60}s.`,
      status: "RESOURCE_EXHAUSTED",
      details: [
        {
          "@type": "type.googleapis.com/google.rpc.ErrorInfo",
          reason: "QUOTA_EXHAUSTED",
          domain: "cloudcode-pa.googleapis.com",
          metadata: {
            uiMessage: "true",
            model: "claude-opus-4-6-thinking",
            quotaResetDelay: `${resetDelaySeconds}s`,
            quotaResetTimeStamp: resetTimeStamp
          }
        },
        {
          "@type": "type.googleapis.com/google.rpc.RetryInfo",
          retryDelay: `${resetDelaySeconds}s`
        }
      ]
    }
  });
  error.isUpstreamApiError = true;
  return error;
}

function createRateLimitError(retryDelayMs) {
  const error = new Error('Rate limit');
  error.status = 429;
  error.rawBody = JSON.stringify({
    error: {
      code: 429,
      message: "Rate limit exceeded",
      status: "RESOURCE_EXHAUSTED",
      details: [
        {
          "@type": "type.googleapis.com/google.rpc.RetryInfo",
          retryDelay: `${retryDelayMs}ms`
        }
      ]
    }
  });
  error.isUpstreamApiError = true;
  return error;
}

function createCapacityError() {
  const error = new Error('Capacity exhausted');
  error.status = 503;
  error.rawBody = JSON.stringify({
    error: {
      code: 503,
      message: "Model capacity exhausted",
      status: "UNAVAILABLE",
      details: [
        {
          "@type": "type.googleapis.com/google.rpc.ErrorInfo",
          reason: "MODEL_CAPACITY_EXHAUSTED"
        }
      ]
    }
  });
  error.isUpstreamApiError = true;
  return error;
}

// 简化版的重试函数（复制核心逻辑）
function parseDurationToMs(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (typeof value !== 'string') return null;

  const s = value.trim();
  if (!s) return null;

  const msMatch = s.match(/^(\d+(\.\d+)?)\s*ms$/i);
  if (msMatch) return Math.max(0, Math.floor(Number(msMatch[1])));

  const secMatch = s.match(/^(\d+(\.\d+)?)\s*s$/i);
  if (secMatch) return Math.max(0, Math.floor(Number(secMatch[1]) * 1000));

  const num = Number(s);
  if (Number.isFinite(num)) return Math.max(0, Math.floor(num));
  return null;
}

function tryParseJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractUpstreamErrorBody(error) {
  if (error?.isUpstreamApiError && error.rawBody) {
    return tryParseJson(error.rawBody) || error.rawBody;
  }
  if (error?.response?.data) {
    return tryParseJson(error.response.data) || error.response.data;
  }
  return tryParseJson(error?.message);
}

function getUpstreamRetryDelayMs(error) {
  const body = extractUpstreamErrorBody(error);
  const root = (body && typeof body === 'object') ? body : null;
  const inner = root?.error || root;
  const details = Array.isArray(inner?.details) ? inner.details : [];

  let bestMs = null;
  let hasTimestamp = false;
  
  for (const d of details) {
    if (!d || typeof d !== 'object') continue;

    const meta = d.metadata && typeof d.metadata === 'object' ? d.metadata : null;
    
    const ts = meta?.quotaResetTimeStamp;
    if (typeof ts === 'string' && !hasTimestamp) {
      const t = Date.parse(ts);
      if (Number.isFinite(t)) {
        const deltaMs = Math.max(0, t - Date.now());
        bestMs = deltaMs;
        hasTimestamp = true;
      }
    }

    if (!hasTimestamp) {
      const quotaResetDelayMs = parseDurationToMs(meta?.quotaResetDelay);
      if (quotaResetDelayMs !== null) bestMs = bestMs === null ? quotaResetDelayMs : Math.max(bestMs, quotaResetDelayMs);

      const retryDelayMs = parseDurationToMs(d.retryDelay);
      if (retryDelayMs !== null) bestMs = bestMs === null ? retryDelayMs : Math.max(bestMs, retryDelayMs);
    }
  }

  const reason = details.find(d => d?.reason)?.reason;
  if (reason === 'MODEL_CAPACITY_EXHAUSTED') {
    bestMs = bestMs === null ? 1000 : Math.max(bestMs, 1000);
  }

  return bestMs;
}

function getUpstreamResetTimestamp(error) {
  const body = extractUpstreamErrorBody(error);
  const root = (body && typeof body === 'object') ? body : null;
  const inner = root?.error || root;
  const details = Array.isArray(inner?.details) ? inner.details : [];

  for (const d of details) {
    if (!d || typeof d !== 'object') continue;
    const meta = d.metadata && typeof d.metadata === 'object' ? d.metadata : null;
    const ts = meta?.quotaResetTimeStamp;
    if (typeof ts === 'string') {
      const t = Date.parse(ts);
      if (Number.isFinite(t)) {
        return t;
      }
    }
  }
  return null;
}

function isRetryableError(status, error, cooldownThreshold) {
  const body = extractUpstreamErrorBody(error);
  const root = (body && typeof body === 'object') ? body : null;
  const inner = root?.error || root;
  const details = Array.isArray(inner?.details) ? inner.details : [];
  const reason = details.find(d => d?.reason)?.reason;

  if (status === 429 && reason === 'QUOTA_EXHAUSTED') {
    const delayMs = getUpstreamRetryDelayMs(error);
    const isLongCooldown = delayMs !== null && delayMs >= cooldownThreshold;
    return { retryable: !isLongCooldown, isQuotaExhausted: isLongCooldown };
  }

  if (status === 429) {
    return { retryable: true, isQuotaExhausted: false };
  }

  if (status === 503 && reason === 'MODEL_CAPACITY_EXHAUSTED') {
    return { retryable: true, isQuotaExhausted: false };
  }

  return { retryable: false, isQuotaExhausted: false };
}

async function with429Retry(fn, maxRetries, options = {}) {
  const loggerPrefix = options.loggerPrefix || '';
  const tokenId = options.tokenId || null;
  const modelId = options.modelId || null;
  const cooldownThreshold = mockConfig.quota.longCooldownThreshold;
  let attempt = 0;

  while (true) {
    try {
      return await fn(attempt);
    } catch (error) {
      const status = Number(error.status || error.statusCode || error.response?.status);
      const { retryable, isQuotaExhausted } = isRetryableError(status, error, cooldownThreshold);

      if (isQuotaExhausted && tokenId && modelId) {
        const explicitDelayMs = getUpstreamRetryDelayMs(error);
        const upstreamResetTimestamp = getUpstreamResetTimestamp(error);

        if (explicitDelayMs !== null) {
          if (!mockTokenCooldownManager.isAvailable(tokenId, modelId)) {
            throw error;
          }

          let finalResetTimestamp = upstreamResetTimestamp;
          const { resetTime: quotaResetTime } = mockQuotaManager.getModelGroupResetTime(tokenId, modelId);
          if (quotaResetTime) {
            finalResetTimestamp = quotaResetTime;
          }

          if (finalResetTimestamp && finalResetTimestamp > Date.now()) {
            const groupKey = mockModelGroups.getGroupKey(modelId);
            const resetDate = new Date(finalResetTimestamp);
            mockLogger.warn(
              `${loggerPrefix}额度耗尽，恢复时间 ${Math.round(explicitDelayMs / 1000 / 60)} 分钟后，` +
              `超过阈值(${Math.round(cooldownThreshold / 1000 / 60)}分钟)，` +
              `禁用 ${groupKey} 系列直到 ${resetDate.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`
            );
            mockTokenCooldownManager.setCooldown(tokenId, modelId, finalResetTimestamp);
          }
        }
        throw error;
      }

      if (retryable && attempt < maxRetries) {
        const explicitDelayMs = getUpstreamRetryDelayMs(error);
        const errorType = status === 503 ? '503 (容量不足)' : '429 (速率限制)';
        const nextAttempt = attempt + 1;
        mockLogger.warn(
          `${loggerPrefix}收到 ${errorType}，将进行第 ${nextAttempt} 次重试（共 ${maxRetries} 次）` +
          (explicitDelayMs !== null ? `（上游提示≈${explicitDelayMs}ms）` : '')
        );
        attempt = nextAttempt;
        continue;
      }
      throw error;
    }
  }
}

// 测试用例
async function runTests() {
  console.log('========================================');
  console.log('测试 1: 额度耗尽（97小时后恢复）- 应该禁用不重试');
  console.log('========================================');
  try {
    const resetTime = new Date(Date.now() + 97 * 3600 * 1000).toISOString();
    const error = createQuotaExhaustedError(resetTime, 97 * 3600);
    
    await with429Retry(
      async () => { throw error; },
      3,
      {
        loggerPrefix: '[Test1] ',
        tokenId: 'test-token-1',
        modelId: 'claude-opus-4-6-thinking'
      }
    );
    console.log('❌ 测试失败：应该抛出错误\n');
  } catch (e) {
    console.log('✅ 测试通过：正确抛出错误\n');
  }

  console.log('========================================');
  console.log('测试 2: 短时间速率限制（30分钟后恢复）- 应该重试');
  console.log('========================================');
  try {
    let callCount = 0;
    const resetTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const error = createQuotaExhaustedError(resetTime, 30 * 60);
    
    await with429Retry(
      async () => {
        callCount++;
        if (callCount <= 2) throw error;
        return 'success';
      },
      3,
      {
        loggerPrefix: '[Test2] ',
        tokenId: 'test-token-2',
        modelId: 'claude-opus-4-6-thinking'
      }
    );
    console.log(`✅ 测试通过：重试 ${callCount} 次后成功\n`);
  } catch (e) {
    console.log('❌ 测试失败：不应该抛出错误\n');
  }

  console.log('========================================');
  console.log('测试 3: 普通速率限制（无 QUOTA_EXHAUSTED）- 应该重试');
  console.log('========================================');
  try {
    let callCount = 0;
    const error = createRateLimitError(1000);
    
    await with429Retry(
      async () => {
        callCount++;
        if (callCount <= 2) throw error;
        return 'success';
      },
      3,
      {
        loggerPrefix: '[Test3] ',
        tokenId: 'test-token-3',
        modelId: 'gemini-2.0-flash-exp'
      }
    );
    console.log(`✅ 测试通过：重试 ${callCount} 次后成功\n`);
  } catch (e) {
    console.log('❌ 测试失败：不应该抛出错误\n');
  }

  console.log('========================================');
  console.log('测试 4: 503 容量不足 - 应该重试');
  console.log('========================================');
  try {
    let callCount = 0;
    const error = createCapacityError();
    
    await with429Retry(
      async () => {
        callCount++;
        if (callCount <= 2) throw error;
        return 'success';
      },
      3,
      {
        loggerPrefix: '[Test4] ',
        tokenId: 'test-token-4',
        modelId: 'gemini-2.0-flash-exp'
      }
    );
    console.log(`✅ 测试通过：重试 ${callCount} 次后成功\n`);
  } catch (e) {
    console.log('❌ 测试失败：不应该抛出错误\n');
  }

  console.log('========================================');
  console.log('测试 5: 使用真实错误 JSON（2026-03-11恢复）');
  console.log('========================================');
  try {
    const error = new Error('Quota exhausted');
    error.status = 429;
    error.rawBody = JSON.stringify({
      error: {
        code: 429,
        message: "You have exhausted your capacity on this model. Your quota will reset after 97h3m17s.",
        status: "RESOURCE_EXHAUSTED",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.ErrorInfo",
            reason: "QUOTA_EXHAUSTED",
            domain: "cloudcode-pa.googleapis.com",
            metadata: {
              uiMessage: "true",
              model: "claude-opus-4-6-thinking",
              quotaResetDelay: "97h3m17.470376967s",
              quotaResetTimeStamp: "2026-03-11T07:55:32Z"
            }
          },
          {
            "@type": "type.googleapis.com/google.rpc.RetryInfo",
            retryDelay: "349397.470376967s"
          }
        ]
      }
    });
    error.isUpstreamApiError = true;
    
    await with429Retry(
      async () => { throw error; },
      3,
      {
        loggerPrefix: '[Test5] ',
        tokenId: 'test-token-5',
        modelId: 'claude-opus-4-6-thinking'
      }
    );
    console.log('❌ 测试失败：应该抛出错误\n');
  } catch (e) {
    console.log('✅ 测试通过：正确抛出错误\n');
  }
}

runTests().catch(console.error);
