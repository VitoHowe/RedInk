import { logger } from '../utils/logger';
import { loadTextConfig } from '../config';
import { TextChatClient } from '../utils/textClient';
import fs from 'fs';
import path from 'path';

/**
 * 页面数据结构
 */
export interface PageData {
  index: number;
  type: 'cover' | 'content' | 'summary';
  content: string;
}

/**
 * 大纲生成结果
 */
export interface OutlineResult {
  success: boolean;
  outline?: string;
  pages?: PageData[];
  has_images?: boolean;
  error?: string;
}

/**
 * 大纲生成服务
 */
export class OutlineService {
  private textConfig: any;
  private client: TextChatClient;
  private promptTemplate: string;

  constructor() {
    logger.debug('初始化 OutlineService...');
    this.textConfig = this._loadTextConfig();
    this.client = this._getClient();
    this.promptTemplate = this._loadPromptTemplate();
    logger.info(`OutlineService 初始化完成，使用服务商: ${this.textConfig.active_provider}`);
  }

  /**
   * 加载文本生成配置
   */
  private _loadTextConfig(): any {
    const config = loadTextConfig();
    logger.debug(`文本配置加载成功: active=${config.active_provider}`);
    return config;
  }

  /**
   * 根据配置获取客户端
   */
  private _getClient(): TextChatClient {
    const activeProvider = this.textConfig.active_provider || 'google_gemini';
    const providers = this.textConfig.providers || {};

    if (Object.keys(providers).length === 0) {
      logger.error('未找到任何文本生成服务商配置');
      throw new Error(
        '未找到任何文本生成服务商配置。\n' +
        '解决方案：\n' +
        '1. 在系统设置页面添加文本生成服务商\n' +
        '2. 或手动编辑 text_providers.yaml 文件'
      );
    }

    if (!(activeProvider in providers)) {
      const available = Object.keys(providers).join(', ');
      logger.error(`文本服务商 [${activeProvider}] 不存在，可用: ${available}`);
      throw new Error(
        `未找到文本生成服务商配置: ${activeProvider}\n` +
        `可用的服务商: ${available}\n` +
        '解决方案：在系统设置中选择一个可用的服务商'
      );
    }

    const providerConfig = providers[activeProvider] || {};

    if (!providerConfig.api_key) {
      logger.error(`文本服务商 [${activeProvider}] 未配置 API Key`);
      throw new Error(
        `文本服务商 ${activeProvider} 未配置 API Key\n` +
        '解决方案：在系统设置页面编辑该服务商，填写 API Key'
      );
    }

    logger.info(`使用文本服务商: ${activeProvider} (type=${providerConfig.type})`);
    return new TextChatClient(
      providerConfig.api_key,
      providerConfig.base_url,
      providerConfig.endpoint_type
    );
  }

  /**
   * 加载提示词模板
   */
  private _loadPromptTemplate(): string {
    // 使用相对路径从项目根目录加载
    const promptPath = path.join(process.cwd(), 'prompts', 'outline_prompt.txt');
    return fs.readFileSync(promptPath, 'utf-8');
  }

  /**
   * 解析大纲文本为页面数组
   */
  private _parseOutline(outlineText: string): PageData[] {
    // 按 <page> 分割页面（兼容旧的 --- 分隔符）
    let pagesRaw: string[];
    if (outlineText.includes('<page>')) {
      pagesRaw = outlineText.split(/<page>/i);
    } else {
      // 向后兼容：如果没有 <page> 则使用 ---
      pagesRaw = outlineText.split('---');
    }

    const pages: PageData[] = [];

    pagesRaw.forEach((pageText, index) => {
      pageText = pageText.trim();
      if (!pageText) return;

      let pageType: 'cover' | 'content' | 'summary' = 'content';
      const typeMatch = pageText.match(/^\[(\S+)\]/);
      
      if (typeMatch) {
        const typeCn = typeMatch[1];
        const typeMapping: Record<string, 'cover' | 'content' | 'summary'> = {
          '封面': 'cover',
          '内容': 'content',
          '总结': 'summary',
        };
        pageType = typeMapping[typeCn] || 'content';
      }

      pages.push({
        index,
        type: pageType,
        content: pageText
      });
    });

    return pages;
  }

  /**
   * 生成大纲
   */
  async generateOutline(
    topic: string,
    images?: Buffer[]
  ): Promise<OutlineResult> {
    try {
      logger.info(`开始生成大纲: topic=${topic.slice(0, 50)}..., images=${images?.length || 0}`);
      
      let prompt = this.promptTemplate.replace('{topic}', topic);

      if (images && images.length > 0) {
        prompt += `\n\n注意：用户提供了 ${images.length} 张参考图片，请在生成大纲时考虑这些图片的内容和风格。这些图片可能是产品图、个人照片或场景图，请根据图片内容来优化大纲，使生成的内容与图片相关联。`;
        logger.debug(`添加了 ${images.length} 张参考图片到提示词`);
      }

      // 从配置中获取模型参数
      const activeProvider = this.textConfig.active_provider || 'google_gemini';
      const providerConfig = this.textConfig.providers[activeProvider] || {};

      const model = providerConfig.model || 'gemini-2.0-flash-exp';
      const temperature = providerConfig.temperature ?? 1.0;
      const maxOutputTokens = providerConfig.max_output_tokens || 8000;

      logger.info(`调用文本生成 API: model=${model}, temperature=${temperature}`);
      
      const outlineText = await this.client.generateText(
        prompt,
        model,
        temperature,
        maxOutputTokens,
        images
      );

      logger.debug(`API 返回文本长度: ${outlineText.length} 字符`);
      const pages = this._parseOutline(outlineText);
      logger.info(`大纲解析完成，共 ${pages.length} 页`);

      return {
        success: true,
        outline: outlineText,
        pages,
        has_images: images !== undefined && images.length > 0
      };

    } catch (error: any) {
      const errorMsg = error.message || String(error);
      logger.error(`大纲生成失败: ${errorMsg}`);

      // 根据错误类型提供更详细的错误信息
      let detailedError: string;

      if (errorMsg.toLowerCase().includes('api_key') || 
          errorMsg.toLowerCase().includes('unauthorized') || 
          errorMsg.includes('401')) {
        detailedError = 
          `API 认证失败。\n` +
          `错误详情: ${errorMsg}\n` +
          '可能原因：\n' +
          '1. API Key 无效或已过期\n' +
          '2. API Key 没有访问该模型的权限\n' +
          '解决方案：在系统设置页面检查并更新 API Key';
      } else if (errorMsg.toLowerCase().includes('model') || errorMsg.includes('404')) {
        detailedError = 
          `模型访问失败。\n` +
          `错误详情: ${errorMsg}\n` +
          '可能原因：\n' +
          '1. 模型名称不正确\n' +
          '2. 没有访问该模型的权限\n' +
          '解决方案：在系统设置页面检查模型名称配置';
      } else if (errorMsg.toLowerCase().includes('timeout') || errorMsg.includes('连接')) {
        detailedError = 
          `网络连接失败。\n` +
          `错误详情: ${errorMsg}\n` +
          '可能原因：\n' +
          '1. 网络连接不稳定\n' +
          '2. API 服务暂时不可用\n' +
          '3. Base URL 配置错误\n' +
          '解决方案：检查网络连接，稍后重试';
      } else if (errorMsg.toLowerCase().includes('rate') || 
                 errorMsg.includes('429') || 
                 errorMsg.toLowerCase().includes('quota')) {
        detailedError = 
          `API 配额限制。\n` +
          `错误详情: ${errorMsg}\n` +
          '可能原因：\n' +
          '1. API 调用次数超限\n' +
          '2. 账户配额用尽\n' +
          '解决方案：等待配额重置，或升级 API 套餐';
      } else {
        detailedError = 
          `大纲生成失败。\n` +
          `错误详情: ${errorMsg}\n` +
          '可能原因：\n' +
          '1. Text API 配置错误或密钥无效\n' +
          '2. 网络连接问题\n' +
          '3. 模型无法访问或不存在\n' +
          '建议：检查配置文件 text_providers.yaml';
      }

      return {
        success: false,
        error: detailedError
      };
    }
  }
}

/**
 * 获取大纲生成服务实例
 * 每次调用都创建新实例以确保配置是最新的
 */
export function getOutlineService(): OutlineService {
  return new OutlineService();
}