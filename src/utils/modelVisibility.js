const HIDDEN_MODEL_IDS = new Set([
  'tab_flash_lite_preview'
]);

const HIDDEN_MODEL_PREFIXES = [
  'chat_'
];

function isMarkedInternal(modelData) {
  if (!modelData || typeof modelData !== 'object') return false;

  if (modelData.isInternal === true || modelData.is_internal === true) {
    return true;
  }

  const visibility = String(modelData.visibility || modelData.lifecycle || '').trim().toLowerCase();
  return visibility === 'internal';
}

export function isModelUserFacing(modelId, modelData = null) {
  if (typeof modelId !== 'string') return false;
  const normalizedId = modelId.trim();
  if (!normalizedId) return false;

  if (HIDDEN_MODEL_IDS.has(normalizedId)) return false;
  if (HIDDEN_MODEL_PREFIXES.some(prefix => normalizedId.startsWith(prefix))) return false;
  if (isMarkedInternal(modelData)) return false;

  return true;
}

export function toOpenAIModelItem(modelId, created, owner = 'google') {
  return {
    id: modelId,
    object: 'model',
    created,
    owned_by: owner
  };
}
