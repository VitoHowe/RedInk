/**
 * Google GenAI 客户端封装
 * 使用 Google Generative AI SDK
 */
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { logger } from './logger';

/**
 * 解析 GenAI 错误信息
 */
function parseGenaiError(error: any): string {
  const errorStr = error.message?.toLowerCase() || '';
  const errorOriginal = error.message || String(error);

  // 401 认证错误
  if (errorStr.includes('401') || errorStr.includes('unauthenticated')) {
    if (errorStr.includes('api key') && errorStr.includes('not supported')) {
      return (
        '❌ API Key 认证失败：Vertex AI 不支持 API Key\n\n' +
        '【错误原因】\n' +
        '您可能误用了 Vertex AI 模式，该模式需要 OAuth2 认证而非 API Key。\n\n' +
        '【解决方案】\n' +
        '1. 如果您使用 Google AI Studio 的 API Key：\n' +
        '   - 确保在设置中没有配置 base_url（留空即可）\n' +
        '   - API Key 获取地址: https://aistudio.google.com/app/apikey\n\n' +
        '2. 如果您使用 Google Cloud 的 API Key：\n' +
        '   - 确保 API Key 已启用 Generative Language API\n' +
        '   - 在 Google Cloud Console 检查 API 权限'
      );
    }
  }

  // 403 权限错误
  if (errorStr.includes('403') || errorStr.includes('permission_denied') || errorStr.includes('forbidden')) {
    return (
      '❌ 权限被拒绝\n\n' +
      '【可能原因】\n' +
      '1. API Key 没有访问该模型的权限\n' +
      '2. 模型可能需要特殊权限或白名单\n' +
      '3. 项目配额或限制\n\n' +
      '【解决方案】\n' +
      '1. 检查 Google Cloud Console 中的 API 权限\n' +
      '2. 确认模型是否对您的账户开放'
    );
  }

  // 404 资源不存在
  if (errorStr.includes('404') || errorStr.includes('not_found') || errorStr.includes('not found')) {
    if (errorStr.includes('model')) {
      return (
        '❌ 模型不存在\n\n' +
        '【可能原因】\n' +
        '1. 模型名称拼写错误\n' +
        '2. 该模型已下线或更名\n' +
        '3. 该模型尚未在您的区域开放\n\n' +
        '【解决方案】\n' +
        '1. 检查模型名称是否正确\n' +
        '2. 推荐使用: gemini-2.0-flash-exp\n' +
        '3. 查看官方文档获取最新可用模型列表'
      );
    }
  }

  // 429 速率限制/配额用尽
  if (errorStr.includes('429') || errorStr.includes('resource_exhausted') || errorStr.includes('quota')) {
    return (
      '⏳ API 配额或速率限制\n\n' +
      '【可能原因】\n' +
      '1. 请求频率过高\n' +
      '2. 免费配额已用尽\n' +
      '3. 账户配额达到上限\n\n' +
      '【解决方案】\n' +
      '1. 稍后再试（通常等待 1-2 分钟）\n' +
      '2. 检查 Google Cloud Console 中的配额使用情况\n' +
      '3. 考虑升级计划或申请更多配额'
    );
  }

  // 安全过滤
  if (errorStr.includes('safety') || errorStr.includes('blocked') || errorStr.includes('filter')) {
    return (
      '🛡️ 内容被安全过滤器拦截\n\n' +
      '【说明】\n' +
      '您的提示词或生成内容触发了 Google 的安全过滤机制。\n\n' +
      '【解决方案】\n' +
      '1. 修改提示词，使用更中性的描述\n' +
      '2. 避免涉及敏感话题的内容\n' +
      '3. 尝试换一种表达方式描述相同内容'
    );
  }

  // 默认错误
  return (
    `❌ API 调用失败\n\n` +
    `【原始错误】\n${errorOriginal.substring(0, 500)}\n\n` +
    '【通用解决方案】\n' +
    '1. 检查 API Key 是否正确配置\n' +
    '2. 检查网络连接是否正常\n' +
    '3. 尝试更换模型或简化提示词'
  );
}

/**
 * GenAI 客户端类
 */
export class GenAIClient {
  private genai: GoogleGenerativeAI;
  private apiKey: string;
  private baseUrl?: string;

  constructor(apiKey?: string, baseUrl?: string) {
    if (!apiKey) {
      throw new Error(
        'Google Cloud API Key 未配置。\n' +
        '解决方案：在系统设置页面编辑该服务商，填写 API Key'
      );
    }

    this.apiKey = apiKey;
    this.baseUrl = baseUrl;

    // 初始化 Google Generative AI
    this.genai = new GoogleGenerativeAI(apiKey);
  }

  /**
   * 生成文本
   */
  async generateText(
    prompt: string,
    model: string = 'gemini-2.0-flash-exp',
    temperature: number = 1.0,
    maxOutputTokens: number = 8000,
    useSearch: boolean = false,
    useThinking: boolean = false,
    images?: Buffer[],
    systemPrompt?: string
  ): Promise<string> {
    try {
      const generativeModel: GenerativeModel = this.genai.getGenerativeModel({
        model,
        generationConfig: {
          temperature,
          maxOutputTokens,
        },
      });

      // 构建内容部分
      const parts: any[] = [{ text: prompt }];

      // 添加图片
      if (images && images.length > 0) {
        for (const imgData of images) {
          parts.push({
            inlineData: {
              mimeType: 'image/png',
              data: imgData.toString('base64')
            }
          });
        }
      }

      // 生成内容
      const result = await generativeModel.generateContent(parts);
      const response = await result.response;
      return response.text();

    } catch (error: any) {
      logger.error(`GenAI 文本生成失败: ${error.message}`);
      throw new Error(parseGenaiError(error));
    }
  }

  /**
   * 生成图片
   */
  async generateImage(
    prompt: string,
    model: string = 'gemini-3-pro-image-preview',
    aspectRatio: string = '3:4',
    temperature: number = 1.0
  ): Promise<Buffer> {
    try {
      const generativeModel: GenerativeModel = this.genai.getGenerativeModel({
        model,
        generationConfig: {
          temperature,
          maxOutputTokens: 32768,
          responseMimeType: 'image/png',
        },
      });

      const result = await generativeModel.generateContent([{ text: prompt }]);
      const response = await result.response;
      
      // 提取图片数据
      const candidates = response.candidates;
      if (!candidates || candidates.length === 0) {
        throw new Error('API 返回为空，未生成图片');
      }

      const parts = candidates[0].content.parts;
      for (const part of parts) {
        if (part.inlineData) {
          const base64Data = part.inlineData.data;
          return Buffer.from(base64Data, 'base64');
        }
      }

      throw new Error('未找到图片数据');

    } catch (error: any) {
      logger.error(`GenAI 图片生成失败: ${error.message}`);
      throw new Error(parseGenaiError(error));
    }
  }
}