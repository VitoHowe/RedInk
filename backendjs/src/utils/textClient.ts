/**
 * Text API 客户端封装
 * 支持 OpenAI 兼容的文本生成 API
 */
import axios, { AxiosInstance } from 'axios';
import { logger } from './logger';
import { compressImage } from './imageCompressor';

/**
 * 重试装饰器 - 处理 429 错误
 */
function retryOn429(maxRetries: number = 3, baseDelay: number = 2) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          return await originalMethod.apply(this, args);
        } catch (error: any) {
          const errorStr = error.message?.toLowerCase() || '';
          if (errorStr.includes('429') || errorStr.includes('rate')) {
            if (attempt < maxRetries - 1) {
              const waitTime = Math.pow(baseDelay, attempt) + Math.random();
              logger.warn(
                `[重试] 遇到限流,${waitTime.toFixed(1)}秒后重试 ` +
                `(尝试 ${attempt + 2}/${maxRetries})`
              );
              await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
              continue;
            }
          }
          throw error;
        }
      }
      throw new Error(
        `Text API 重试 ${maxRetries} 次后仍失败。\n` +
        `可能原因:\n` +
        `1. API持续限流或配额不足\n` +
        `2. 网络连接持续不稳定\n` +
        `3. API服务暂时不可用\n` +
        `建议:稍后再试,或联系API服务提供商`
      );
    };

    return descriptor;
  };
}

/**
 * Text Chat 客户端类
 */
export class TextChatClient {
  private apiKey: string;
  private baseUrl: string;
  private chatEndpoint: string;
  private axios: AxiosInstance;

  constructor(
    apiKey?: string,
    baseUrl?: string,
    endpointType?: string
  ) {
    if (!apiKey) {
      throw new Error(
        'Text API Key 未配置。\n' +
        '解决方案:在系统设置页面编辑文本生成服务商,填写 API Key'
      );
    }

    this.apiKey = apiKey;
    this.baseUrl = (baseUrl || 'https://api.openai.com')
      .replace(/\/+$/, '')
      .replace(/\/v1$/, '');

    // 支持自定义端点路径
    const endpoint = endpointType || '/v1/chat/completions';
    this.chatEndpoint = `${this.baseUrl}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`;

    // 创建 axios 实例
    this.axios = axios.create({
      timeout: 300000, // 5分钟超时
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      }
    });
  }

  /**
   * 将图片数据编码为 base64
   */
  private encodeImageToBase64(imageData: Buffer): string {
    return imageData.toString('base64');
  }

  /**
   * 构建包含图片的 content
   */
  private async buildContentWithImages(
    text: string,
    images?: (Buffer | string)[]
  ): Promise<string | any[]> {
    if (!images || images.length === 0) {
      return text;
    }

    const content: any[] = [{ type: 'text', text }];

    for (const img of images) {
      let imageUrl: string;
      
      if (Buffer.isBuffer(img)) {
        // 压缩图片到 200KB 以内
        const compressedImg = await compressImage(img, 200);
        const base64Data = this.encodeImageToBase64(compressedImg);
        imageUrl = `data:image/png;base64,${base64Data}`;
      } else {
        // 已经是 URL
        imageUrl = img;
      }

      content.push({
        type: 'image_url',
        image_url: { url: imageUrl }
      });
    }

    return content;
  }

  /**
   * 生成文本(支持图片输入)
   */
  @retryOn429(3, 2)
  async generateText(
    prompt: string,
    model: string = 'gemini-3-pro-preview',
    temperature: number = 1.0,
    maxOutputTokens: number = 8000,
    images?: (Buffer | string)[],
    systemPrompt?: string
  ): Promise<string> {
    const messages: any[] = [];

    // 添加系统提示词
    if (systemPrompt) {
      messages.push({
        role: 'system',
        content: systemPrompt
      });
    }

    // 构建用户消息内容
    const content = await this.buildContentWithImages(prompt, images);
    messages.push({
      role: 'user',
      content
    });

    const payload = {
      model,
      messages,
      temperature,
      max_tokens: maxOutputTokens,
      stream: false
    };

    try {
      const response = await this.axios.post(this.chatEndpoint, payload);
      const result = response.data;

      // 提取生成的文本
      if (result.choices && result.choices.length > 0) {
        return result.choices[0].message.content;
      } else {
        throw new Error(
          `Text API 响应格式异常:未找到生成的文本。\n` +
          `响应数据: ${JSON.stringify(result).substring(0, 500)}\n` +
          `可能原因:\n` +
          `1. API返回格式与OpenAI标准不一致\n` +
          `2. 请求被拒绝或过滤\n` +
          `3. 模型输出为空\n` +
          `建议:检查API文档确认响应格式`
        );
      }
    } catch (error: any) {
      const statusCode = error.response?.status;
      const errorDetail = error.response?.data 
        ? JSON.stringify(error.response.data).substring(0, 500)
        : error.message;

      // 根据状态码给出更详细的错误信息
      if (statusCode === 401) {
        throw new Error(
          '❌ API Key 认证失败\n\n' +
          '【可能原因】\n' +
          '1. API Key 无效或已过期\n' +
          '2. API Key 格式错误(复制时可能包含空格)\n' +
          '3. API Key 被禁用或删除\n\n' +
          '【解决方案】\n' +
          '1. 在系统设置页面检查 API Key 是否正确\n' +
          '2. 重新获取 API Key\n' +
          `\n【请求地址】${this.chatEndpoint}`
        );
      } else if (statusCode === 403) {
        throw new Error(
          '❌ 权限被拒绝\n\n' +
          '【可能原因】\n' +
          '1. API Key 没有访问该模型的权限\n' +
          '2. 账户配额已用尽\n' +
          '3. 区域限制\n\n' +
          '【解决方案】\n' +
          '1. 检查 API 权限配置\n' +
          '2. 尝试使用其他模型\n' +
          `\n【原始错误】${errorDetail.substring(0, 200)}`
        );
      } else if (statusCode === 404) {
        throw new Error(
          '❌ 模型不存在或 API 端点错误\n\n' +
          '【可能原因】\n' +
          `1. 模型 '${model}' 不存在或已下线\n` +
          '2. Base URL 配置错误\n\n' +
          '【解决方案】\n' +
          '1. 检查模型名称是否正确\n' +
          '2. 检查 Base URL 配置\n' +
          `\n【请求地址】${this.chatEndpoint}`
        );
      } else if (statusCode === 429) {
        throw new Error(
          '⏳ API 配额或速率限制\n\n' +
          '【说明】\n' +
          '请求频率过高或配额已用尽。\n\n' +
          '【解决方案】\n' +
          '1. 稍后再试(等待 1-2 分钟)\n' +
          '2. 检查 API 配额使用情况\n' +
          '3. 考虑升级计划获取更多配额'
        );
      } else if (statusCode && statusCode >= 500) {
        throw new Error(
          `⚠️ API 服务器错误 (${statusCode})\n\n` +
          '【说明】\n' +
          '这是服务端的临时故障,与您的配置无关。\n\n' +
          '【解决方案】\n' +
          '1. 稍等几分钟后重试\n' +
          '2. 如果持续出现,检查服务商状态页'
        );
      } else {
        throw new Error(
          `❌ API 请求失败 (状态码: ${statusCode || '未知'})\n\n` +
          `【原始错误】\n${errorDetail}\n\n` +
          `【请求地址】${this.chatEndpoint}\n` +
          `【模型】${model}\n\n` +
          '【通用解决方案】\n' +
          '1. 检查 API Key 是否正确\n' +
          '2. 检查 Base URL 配置\n' +
          '3. 检查模型名称是否正确'
        );
      }
    }
  }
}

/**
 * 获取 Text Chat 客户端实例
 */
export function getTextChatClient(providerConfig: any): TextChatClient | any {
  const providerType = providerConfig.type || 'openai_compatible';
  const apiKey = providerConfig.api_key;
  const baseUrl = providerConfig.base_url;
  const endpointType = providerConfig.endpoint_type;

  if (providerType === 'google_gemini') {
    // 使用 Google GenAI 客户端
    const { GenAIClient } = require('./genaiClient');
    return new GenAIClient(apiKey, baseUrl);
  } else {
    return new TextChatClient(apiKey, baseUrl, endpointType);
  }
}