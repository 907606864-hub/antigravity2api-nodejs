// 额度汇总页：多账号模型额度聚合视图

const quotaSummaryState = {
    initialized: false,
    loading: false,
    data: null,
    filterText: '',
    includeDisabled: false,
    source: 'all'
};

function qsGetEl(id) {
    return document.getElementById(id);
}

function qsToFiniteNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function qsFormatPercent(value, digits = 1) {
    const num = qsToFiniteNumber(value);
    if (num === null) return '--';
    return `${num.toFixed(digits)}%`;
}

function qsFormatExhaustedRate(rateFraction) {
    const rate = qsToFiniteNumber(rateFraction);
    if (rate === null) return '--';
    return `${(rate * 100).toFixed(1)}%`;
}

function qsFormatMinutes(minutes) {
    const num = qsToFiniteNumber(minutes);
    if (num === null) return '--';
    if (num < 1) return '<1分钟';
    if (num < 60) {
        return `${num < 10 ? num.toFixed(1) : Math.round(num)}分钟`;
    }
    const hours = num / 60;
    if (hours < 24) return `${hours.toFixed(1)}小时`;
    const days = hours / 24;
    return `${days.toFixed(1)}天`;
}

function qsFormatDateTime(timestamp) {
    const num = qsToFiniteNumber(timestamp);
    if (num === null) return '--';
    try {
        return new Date(num).toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch {
        return '--';
    }
}

function qsTableMessageRow(message, colspan = 6) {
    return `
        <tr>
            <td colspan="${colspan}">
                <div class="empty-state-small">${escapeHtml(message)}</div>
            </td>
        </tr>
    `;
}

function qsGetSensitivityHidden() {
    return typeof sensitiveInfoHidden !== 'undefined' && !!sensitiveInfoHidden;
}

function qsMaskValue(value, head = 2, tail = 2) {
    const text = String(value || '');
    if (!text) return '--';
    if (text.length <= head + tail) return '*'.repeat(Math.max(2, text.length));
    return `${text.slice(0, head)}***${text.slice(-tail)}`;
}

function qsShortTokenId(tokenId) {
    const text = String(tokenId || '');
    if (text.length <= 12) return text || '--';
    return `${text.slice(0, 6)}...${text.slice(-4)}`;
}

function qsBindEvents() {
    if (quotaSummaryState.initialized) return;

    const filterInput = qsGetEl('quotaSummaryModelFilter');
    const sourceSelect = qsGetEl('quotaSummarySource');
    const includeDisabledInput = qsGetEl('quotaSummaryIncludeDisabled');
    const refreshBtn = qsGetEl('quotaSummaryRefreshBtn');

    if (filterInput) {
        filterInput.addEventListener('input', () => {
            quotaSummaryState.filterText = filterInput.value || '';
            qsRenderTable();
        });
    }

    if (includeDisabledInput) {
        includeDisabledInput.addEventListener('change', () => {
            quotaSummaryState.includeDisabled = !!includeDisabledInput.checked;
            refreshQuotaSummary(false);
        });
    }

    if (sourceSelect) {
        sourceSelect.addEventListener('change', () => {
            quotaSummaryState.source = sourceSelect.value || 'all';
            refreshQuotaSummary(false);
        });
    }

    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => refreshQuotaSummary(true));
    }

    quotaSummaryState.initialized = true;
}

async function initQuotaSummaryPage(forceRefresh = false) {
    qsBindEvents();

    if (!quotaSummaryState.data || forceRefresh) {
        await refreshQuotaSummary(forceRefresh);
        return;
    }

    qsRenderAll();
}

async function refreshQuotaSummary(forceRefresh = false) {
    if (quotaSummaryState.loading) return;

    const refreshBtn = qsGetEl('quotaSummaryRefreshBtn');
    const includeDisabledInput = qsGetEl('quotaSummaryIncludeDisabled');
    const sourceSelect = qsGetEl('quotaSummarySource');

    if (includeDisabledInput) {
        quotaSummaryState.includeDisabled = !!includeDisabledInput.checked;
    }
    if (sourceSelect) {
        quotaSummaryState.source = sourceSelect.value || 'all';
    }

    quotaSummaryState.loading = true;
    const originalBtnText = refreshBtn ? refreshBtn.textContent : '';

    if (refreshBtn) {
        refreshBtn.disabled = true;
        refreshBtn.textContent = '刷新中...';
    }

    qsRenderLoading('正在加载汇总数据...');

    try {
        const params = new URLSearchParams();
        params.set('refresh', forceRefresh ? 'true' : 'false');
        params.set('includeDisabled', quotaSummaryState.includeDisabled ? 'true' : 'false');
        params.set('source', quotaSummaryState.source || 'all');
        params.set('fetchMissing', 'true');
        params.set('concurrency', '5');

        const response = await authFetch(`/admin/quotas/summary?${params.toString()}`);
        const result = await response.json();

        if (!response.ok || !result?.success) {
            throw new Error(result?.message || '加载失败');
        }

        quotaSummaryState.data = result.data || null;
        qsRenderAll();

        if (forceRefresh) {
            showToast('额度汇总刷新完成', 'success');
        }
    } catch (error) {
        const message = error?.message || '未知错误';
        qsRenderError(`加载失败: ${message}`);
        showToast(`额度汇总加载失败: ${message}`, 'error');
    } finally {
        quotaSummaryState.loading = false;
        if (refreshBtn) {
            refreshBtn.disabled = false;
            refreshBtn.textContent = originalBtnText || '刷新汇总';
        }
    }
}

function qsRenderAll() {
    qsRenderStats();
    qsRenderMeta();
    qsRenderTable();
}

function qsRenderStats() {
    const data = quotaSummaryState.data || {};
    const tokenStats = data.tokenStats || {};
    const models = Array.isArray(data.models) ? data.models : [];
    const exhaustedModelCount = models.filter(item => Number(item?.exhaustedCount || 0) > 0).length;
    const includedTokens = Number(tokenStats.includedTokens ?? tokenStats.totalTokens ?? 0);
    const totalTokensAll = Number(tokenStats.totalTokensAll ?? includedTokens);

    const totalTokensEl = qsGetEl('qsTotalTokens');
    const withQuotaEl = qsGetEl('qsWithQuotaTokens');
    const modelCountEl = qsGetEl('qsModelCount');
    const exhaustedModelCountEl = qsGetEl('qsExhaustedModelCount');

    if (totalTokensEl) {
        totalTokensEl.textContent = totalTokensAll > includedTokens
            ? `${includedTokens}/${totalTokensAll}`
            : String(includedTokens);
    }
    if (withQuotaEl) withQuotaEl.textContent = String(tokenStats.withQuotaData ?? 0);
    if (modelCountEl) modelCountEl.textContent = String(models.length);
    if (exhaustedModelCountEl) exhaustedModelCountEl.textContent = String(exhaustedModelCount);
}

function qsRenderMeta() {
    const data = quotaSummaryState.data || {};
    const generatedAtEl = qsGetEl('quotaSummaryGeneratedAt');
    const refreshStatsEl = qsGetEl('quotaSummaryRefreshStats');
    const sourceStats = data.sourceStats || {};

    if (generatedAtEl) {
        generatedAtEl.textContent = `更新时间: ${qsFormatDateTime(data.generatedAt)}`;
    }

    if (refreshStatsEl) {
        const refreshedCount = Number(data?.refreshStats?.refreshedCount || 0);
        const failedCount = Number(data?.refreshStats?.failedCount || 0);
        const tokenCount = Number(sourceStats?.tokenCount || 0);
        const geminicliCount = Number(sourceStats?.geminicliCount || 0);
        refreshStatsEl.textContent = `刷新统计: 已刷新 ${refreshedCount} 个，失败 ${failedCount} 个 | 来源 Token ${tokenCount} / CLI ${geminicliCount}`;
    }
}

function qsGetFilteredModels() {
    const data = quotaSummaryState.data || {};
    const models = Array.isArray(data.models) ? data.models : [];
    const keyword = String(quotaSummaryState.filterText || '').trim().toLowerCase();

    if (!keyword) return models;

    return models.filter(item => String(item?.modelId || '').toLowerCase().includes(keyword));
}

function qsRenderLoading(message) {
    const body = qsGetEl('quotaSummaryTableBody');
    if (!body) return;
    body.innerHTML = qsTableMessageRow(message || '正在加载...');
}

function qsRenderError(message) {
    const body = qsGetEl('quotaSummaryTableBody');
    if (!body) return;
    body.innerHTML = qsTableMessageRow(message || '加载失败');
}

function qsRenderTable() {
    const body = qsGetEl('quotaSummaryTableBody');
    if (!body) return;

    const data = quotaSummaryState.data;
    if (!data) {
        body.innerHTML = qsTableMessageRow('暂无汇总数据');
        return;
    }

    const models = qsGetFilteredModels();
    if (models.length === 0) {
        body.innerHTML = qsTableMessageRow('未匹配到模型');
        return;
    }

    body.innerHTML = models.map(qsBuildModelRowHtml).join('');
}

function qsBuildModelRowHtml(model) {
    const modelId = String(model?.modelId || '');
    const tokenCount = Number(model?.tokenCount || 0);
    const exhaustedCount = Number(model?.exhaustedCount || 0);
    const exhaustedRateText = qsFormatExhaustedRate(model?.exhaustedRate);
    const avgRemainingPercent = qsToFiniteNumber(model?.avgRemainingPercent);

    let remainingClass = 'success';
    if (avgRemainingPercent !== null && avgRemainingPercent <= 10) remainingClass = 'danger';
    else if (avgRemainingPercent !== null && avgRemainingPercent <= 30) remainingClass = 'warning';

    const exhaustedClass = exhaustedCount > 0 ? 'danger' : 'success';

    return `
        <tr>
            <td class="qs-model-id" title="${escapeHtml(modelId)}">${escapeHtml(modelId || '--')}</td>
            <td>
                <span class="qs-badge ${remainingClass}">${qsFormatPercent(avgRemainingPercent, 1)}</span>
            </td>
            <td>
                <span class="qs-badge ${exhaustedClass}">${exhaustedCount}/${tokenCount}</span>
                <span class="qs-subtext">(${escapeHtml(exhaustedRateText)})</span>
            </td>
            <td>${escapeHtml(model?.avgResetTimeExhausted || '--')}</td>
            <td>${escapeHtml(model?.earliestResetTime || '--')}</td>
            <td>
                <button type="button" class="btn btn-sm btn-secondary" onclick="openQuotaSummaryDetail('${escapeJs(modelId)}')">查看明细</button>
            </td>
        </tr>
    `;
}

function closeQuotaSummaryDetailModal() {
    const modal = qsGetEl('quotaSummaryDetailModal');
    if (modal) modal.remove();
}

function qsRenderDetailRows(entries) {
    if (!Array.isArray(entries) || entries.length === 0) {
        return qsTableMessageRow('暂无账号明细', 8);
    }

    const hideSensitive = qsGetSensitivityHidden();

    return entries.map((entry, index) => {
        const tokenId = String(entry?.tokenId || '');
        const tokenTypeRaw = String(entry?.tokenType || 'token');
        const tokenType = tokenTypeRaw === 'geminicli' ? 'GeminiCLI' : 'Token';
        const emailRaw = String(entry?.email || '');
        const projectRaw = String(entry?.projectId || '');
        const email = hideSensitive ? qsMaskValue(emailRaw, 2, 3) : (emailRaw || '--');
        const projectId = hideSensitive ? qsMaskValue(projectRaw, 2, 2) : (projectRaw || '--');
        const remainingPercent = qsFormatPercent(entry?.remainingPercent, 1);
        const resetTime = entry?.resetTime || '--';
        const resetEta = qsFormatMinutes(entry?.minutesToReset);
        const statusClass = entry?.isExhausted ? 'danger' : 'success';
        const statusText = entry?.isExhausted ? '已耗尽' : '可用';

        return `
            <tr class="${entry?.isExhausted ? 'qs-detail-row-exhausted' : ''}">
                <td>${index + 1}</td>
                <td>${escapeHtml(tokenType)}</td>
                <td title="${escapeHtml(emailRaw || tokenId)}">${escapeHtml(email)}</td>
                <td title="${escapeHtml(tokenId)}">${escapeHtml(qsShortTokenId(tokenId) || '--')}</td>
                <td>${escapeHtml(projectId)}</td>
                <td><span class="qs-badge ${statusClass}">${escapeHtml(statusText)}</span></td>
                <td>${escapeHtml(remainingPercent)}</td>
                <td title="${escapeHtml(resetTime)}">${escapeHtml(resetTime)} <span class="qs-subtext">(${escapeHtml(resetEta)})</span></td>
            </tr>
        `;
    }).join('');
}

function openQuotaSummaryDetail(modelId) {
    const data = quotaSummaryState.data;
    if (!data) {
        showToast('暂无可展示的数据', 'warning');
        return;
    }

    const modelKey = String(modelId || '');
    const detail = data?.detailsByModel?.[modelKey];
    if (!detail) {
        showToast('未找到模型明细', 'warning');
        return;
    }

    const modelSummary = (Array.isArray(data.models) ? data.models : []).find(item => item.modelId === modelKey) || {};
    const entries = Array.isArray(detail.entries) ? detail.entries : [];

    closeQuotaSummaryDetailModal();

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'quotaSummaryDetailModal';

    modal.innerHTML = `
        <div class="modal-content modal-xl quota-summary-detail-modal-content">
            <div class="quota-summary-detail-header">
                <div>
                    <div class="modal-title">模型明细</div>
                    <div class="quota-summary-detail-model" title="${escapeHtml(modelKey)}">${escapeHtml(modelKey)}</div>
                </div>
                <button type="button" class="btn btn-sm btn-secondary" onclick="closeQuotaSummaryDetailModal()">关闭</button>
            </div>
            <div class="quota-summary-detail-stats">
                <span class="qs-badge info">账号数 ${escapeHtml(String(modelSummary.tokenCount || detail.tokenCount || 0))}</span>
                <span class="qs-badge danger">耗尽 ${escapeHtml(String(modelSummary.exhaustedCount || detail.exhaustedCount || 0))}</span>
                <span class="qs-badge success">平均剩余 ${escapeHtml(qsFormatPercent(modelSummary.avgRemainingPercent, 1))}</span>
                <span class="qs-badge warning">平均恢复 ${escapeHtml(modelSummary.avgResetTimeExhausted || '--')}</span>
            </div>
            <div class="quota-summary-detail-table-wrap">
                <table class="quota-summary-detail-table">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>来源</th>
                            <th>账号</th>
                            <th>Token</th>
                            <th>Project</th>
                            <th>状态</th>
                            <th>剩余</th>
                            <th>恢复时间</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${qsRenderDetailRows(entries)}
                    </tbody>
                </table>
            </div>
        </div>
    `;

    modal.addEventListener('click', (event) => {
        if (event.target === modal) {
            closeQuotaSummaryDetailModal();
        }
    });

    document.body.appendChild(modal);
}
