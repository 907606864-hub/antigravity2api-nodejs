// OpenAI 格式转换工具
import config from '../../config/config.js';
import { extractSystemInstruction } from '../utils.js';
import { convertOpenAIToolsToAntigravity } from '../toolConverter.js';
import {
  getSignatureContext,
  pushUserMessage,
  findFunctionNameById,
  pushFunctionResponse,
  createThoughtPart,
  createFunctionCallPart,
  processToolName,
  pushModelMessage,
  buildRequestBody,
  modelMapping,
  isEnableThinking,
  generateGenerationConfig
} from './common.js';

function normalizeContentText(content) {
  if (content === null || content === undefined) return '';
  if (typeof content === 'string') return content;
  if (typeof content === 'number' || typeof content === 'boolean') return String(content);

  let text = '';
  const appendFromObject = (item) => {
    if (!item || typeof item !== 'object') return;
    const itemType = String(item.type || '').toLowerCase();
    if (itemType === 'text' || itemType === 'input_text' || itemType === 'output_text') {
      if (item.text !== undefined && item.text !== null) {
        text += String(item.text);
      }
      return;
    }
    if (typeof item.text === 'string') {
      text += item.text;
    } else if (typeof item.content === 'string') {
      text += item.content;
    }
  };

  if (Array.isArray(content)) {
    for (const item of content) {
      if (typeof item === 'string') text += item;
      else if (typeof item === 'number' || typeof item === 'boolean') text += String(item);
      else appendFromObject(item);
    }
    return text;
  }

  if (typeof content === 'object') {
    appendFromObject(content);
    return text;
  }

  return '';
}

function normalizeToolResultContent(content) {
  if (content === null || content === undefined) return '';
  if (typeof content === 'string') return content;
  if (typeof content === 'number' || typeof content === 'boolean') return String(content);

  if (Array.isArray(content)) {
    return content.map((item) => {
      if (item === null || item === undefined) return '';
      if (typeof item === 'string') return item;
      if (typeof item === 'number' || typeof item === 'boolean') return String(item);
      if (typeof item === 'object') {
        const itemText = normalizeContentText(item);
        if (itemText) return itemText;
        try {
          return JSON.stringify(item);
        } catch {
          return String(item);
        }
      }
      return String(item);
    }).join('');
  }

  if (typeof content === 'object') {
    try {
      return JSON.stringify(content);
    } catch {
      return String(content);
    }
  }

  return String(content);
}

function extractImageDataUrl(item) {
  if (!item || typeof item !== 'object') return '';
  const itemType = String(item.type || '').toLowerCase();
  if (itemType === 'image_url') {
    if (typeof item.image_url === 'string') return item.image_url;
    return item.image_url?.url || '';
  }
  if (itemType === 'input_image') {
    if (typeof item.image_url === 'string') return item.image_url;
    return item.image_url?.url || '';
  }
  return '';
}

function extractImagesFromContent(content) {
  const result = { text: normalizeContentText(content), images: [] };
  if (!Array.isArray(content)) return result;

  for (const item of content) {
    const imageUrl = extractImageDataUrl(item);
    if (!imageUrl) continue;

    const match = imageUrl.match(/^data:image\/([a-z0-9.+-]+);base64,(.+)$/i);
    if (!match) continue;

    result.images.push({
      inlineData: {
        mimeType: `image/${match[1].toLowerCase()}`,
        data: match[2]
      }
    });
  }

  return result;
}

function handleAssistantMessage(message, antigravityMessages, enableThinking, actualModelName, sessionId, hasTools) {
  const hasToolCalls = message.tool_calls && message.tool_calls.length > 0;
  const normalizedAssistantContent = normalizeContentText(message.content);
  const hasContent = normalizedAssistantContent.trim() !== '';
  const { reasoningSignature, reasoningContent, toolSignature, toolContent } = getSignatureContext(sessionId, actualModelName, hasTools);

  const toolCalls = hasToolCalls
    ? message.tool_calls.map((toolCall, index) => {
      const rawToolName = (typeof toolCall?.function?.name === 'string' && toolCall.function.name)
        ? toolCall.function.name
        : `tool_${index + 1}`;
      const safeName = processToolName(rawToolName, sessionId, actualModelName);
      const callId = (typeof toolCall?.id === 'string' && toolCall.id) ? toolCall.id : `tool_call_${index + 1}`;
      const callArgs = toolCall?.function?.arguments;
      const signature = enableThinking
        ? (toolCall.thoughtSignature || toolSignature || message.thoughtSignature || reasoningSignature)
        : null;
      return createFunctionCallPart(callId, safeName, callArgs, signature);
    })
    : [];

  const parts = [];
  if (enableThinking) {
    // 优先使用消息自带的思考内容，否则使用缓存的内容（与签名绑定）
    let reasoningText = ' ';
    let signature = null;
    
    if (typeof message.reasoning_content === 'string' && message.reasoning_content.length > 0) {
      // 消息自带思考内容，使用消息自带的签名或缓存签名
      reasoningText = message.reasoning_content;
      signature = message.thoughtSignature || reasoningSignature || toolSignature;
    } else {
      // 没有思考内容，使用缓存的签名+内容（绑定关系）
      signature = message.thoughtSignature || reasoningSignature || toolSignature;
      if (signature === reasoningSignature) {
        reasoningText = reasoningContent || ' ';
      } else if (signature === toolSignature) {
        reasoningText = toolContent || ' ';
      }
    }
    
    // 只有在有签名时才添加 thought part，避免 API 报错
    if (signature) {
      parts.push(createThoughtPart(reasoningText, signature));
    }
  }
  if (hasContent) {
    const part = { text: normalizedAssistantContent.trimEnd() };
    parts.push(part);
  }
  if (!enableThinking && parts[0]) delete parts[0].thoughtSignature;

  pushModelMessage({ parts, toolCalls, hasContent }, antigravityMessages);
}

function handleToolCall(message, antigravityMessages) {
  const functionName = findFunctionNameById(message.tool_call_id, antigravityMessages);
  const normalizedResultContent = normalizeToolResultContent(message.content);
  pushFunctionResponse(message.tool_call_id, functionName, normalizedResultContent, antigravityMessages);
}

function openaiMessageToAntigravity(openaiMessages, enableThinking, actualModelName, sessionId, hasTools) {
  const antigravityMessages = [];
  for (const message of openaiMessages) {
    if (message.role === 'user' || message.role === 'system') {
      const extracted = extractImagesFromContent(message.content);
      pushUserMessage(extracted, antigravityMessages);
    } else if (message.role === 'assistant') {
      handleAssistantMessage(message, antigravityMessages, enableThinking, actualModelName, sessionId, hasTools);
    } else if (message.role === 'tool') {
      handleToolCall(message, antigravityMessages);
    }
  }
  //console.log(JSON.stringify(antigravityMessages,null,2));
  return antigravityMessages;
}

export function generateRequestBody(openaiMessages, modelName, parameters, openaiTools, token) {
  const enableThinking = isEnableThinking(modelName);
  const actualModelName = modelMapping(modelName);
  const mergedSystemInstruction = extractSystemInstruction(openaiMessages);

  let filteredMessages = openaiMessages;
  let startIndex = 0;
  if (config.useContextSystemPrompt) {
    for (let i = 0; i < openaiMessages.length; i++) {
      if (openaiMessages[i].role === 'system') {
        startIndex = i + 1;
      } else {
        filteredMessages = openaiMessages.slice(startIndex);
        break;
      }
    }
  }

  const tools = convertOpenAIToolsToAntigravity(openaiTools, token.sessionId, actualModelName);
  const hasTools = tools && tools.length > 0;
  //console.log(JSON.stringify(tools, null, 2))
  return buildRequestBody({
    contents: openaiMessageToAntigravity(filteredMessages, enableThinking, actualModelName, token.sessionId, hasTools),
    tools: tools,
    generationConfig: generateGenerationConfig(parameters, enableThinking, actualModelName),
    sessionId: token.sessionId,
    systemInstruction: mergedSystemInstruction
  }, token, actualModelName);
}
