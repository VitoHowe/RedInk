/**
 * Google GenAI 图片生成器
 * 使用 Google Generative AI SDK 生成图片
 */
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { ImageGeneratorBase } from './base';
import { ProviderConfig } from '../config';
import { logger } from '../utils/logger';
import { compressImage } from '../utils/imageCompressor';

/**
 * Google GenAI 生成器类
 */
export class GoogleGenAIGenerator extends ImageGeneratorBase {
  private genai: GoogleGenerativeAI;
  private isVertexai: boolean = false;

  constructor(config: ProviderConfig) {
    super(config);
    logger.debug('初始化 GoogleGenAIGenerator...');

    if (!this.apiKey) {
      logger.error('Google GenAI API Key 未配置');
      throw new Error(
        'Google GenAI API Key 未配置。\n' +
        '解决方案:在系统设置页面编辑该服务商,填写 API Key\n' +
        '获取 API Key: https://aistudio.google.com/app/apikey'
      );
    }

    // 初始化 Google Generative AI
    this.genai = new GoogleGenerativeAI(this.apiKey);
    logger.info('GoogleGenAIGenerator 初始化完成');
  }

  validateConfig(): boolean {
    return !!this.apiKey;
  }

  async generateImage(kwargs: Record<string, any>): Promise<Buffer> {
    const prompt = kwargs.prompt;
    const aspectRatio = kwargs.aspect_ratio || kwargs.aspectRatio || '3:4';
    const temperature = kwargs.temperature || 1.0;
    const model = kwargs.model || 'imagen-3.0-generate-002';
    const referenceImage = kwargs.reference_image || kwargs.referenceImage;

    logger.info(`Google GenAI 生成图片: model=${model}, aspect_ratio=${aspectRatio}`);
    logger.debug(`  prompt 长度: ${prompt.length} 字符, 有参考图: ${!!referenceImage}`);

    try {
      const generativeModel: GenerativeModel = this.genai.getGenerativeModel({
        model,
      });

      // 构建内容部分
      const parts: any[] = [];

      // 如果有参考图,先添加参考图和说明
      if (referenceImage) {
        logger.debug(`  添加参考图片 (${referenceImage.length} bytes)`);
        // 压缩参考图到 200KB 以内
        const compressedRef = await compressImage(referenceImage, 200);
        logger.debug(`  参考图压缩后: ${compressedRef.length} bytes`);
        
        // 添加参考图
        parts.push({
          inlineData: {
            mimeType: 'image/png',
            data: compressedRef.toString('base64')
          }
        });

        // 添加带参考说明的提示词
        const enhancedPrompt = `请参考上面这张图片的视觉风格(包括配色、排版风格、字体风格、装饰元素风格),生成一张风格一致的新图片。

新图片的内容要求:
${prompt}

重要:
1. 必须保持与参考图相同的视觉风格和设计语言
2. 配色方案要与参考图协调一致
3. 排版和装饰元素的风格要统一
4. 但内容要按照新的要求来生成`;
        parts.push({ text: enhancedPrompt });
      } else {
        // 没有参考图,直接使用原始提示词
        parts.push({ text: prompt });
      }

      // 生成内容
      const result = await generativeModel.generateContent(parts);
      const response = await result.response;

      // 提取图片数据
      const candidates = response.candidates;
      if (!candidates || candidates.length === 0) {
        throw new Error('API 返回为空,未生成图片');
      }

      const contentParts = candidates[0].content.parts;
      for (const part of contentParts) {
        if (part.inlineData) {
          const base64Data = part.inlineData.data;
          const imageData = Buffer.from(base64Data, 'base64');
          logger.info(`✅ Google GenAI 图片生成成功: ${imageData.length} bytes`);
          return imageData;
        }
      }

      throw new Error(
        '❌ 图片生成失败:API 返回为空\n\n' +
        '【可能原因】\n' +
        '1. 提示词触发了安全过滤(最常见)\n' +
        '2. 模型不支持当前的图片生成请求\n' +
        '3. 网络传输过程中数据丢失\n\n' +
        '【解决方案】\n' +
        '1. 修改提示词,避免敏感内容\n' +
        '2. 尝试简化提示词\n' +
        '3. 检查网络连接后重试'
      );

    } catch (error: any) {
      logger.error(`Google GenAI 图片生成失败: ${error.message}`);
      throw this.parseError(error);
    }
  }

  /**
   * 解析 GenAI 错误
   */
  private parseError(error: any): Error {
    const errorStr = error.message?.toLowerCase() || '';
    const errorOriginal = error.message || String(error);

    // 401 认证错误
    if (errorStr.includes('401') || errorStr.includes('unauthenticated')) {
      return new Error(
        '❌ API Key 认证失败\n\n' +
        '【可能原因】\n' +
        '1. API Key 无效或已过期\n' +
        '2. API Key 格式错误\n\n' +
        '【解决方案】\n' +
        '1. 检查 API Key 是否正确复制(无多余空格)\n' +
        '2. 前往 Google AI Studio 重新生成 API Key:\n' +
        '   https://aistudio.google.com/app/apikey'
      );
    }

    // 403 权限错误
    if (errorStr.includes('403') || errorStr.includes('permission_denied')) {
      return new Error(
        '❌ 权限被拒绝\n\n' +
        '【可能原因】\n' +
        '1. API Key 没有访问该模型的权限\n' +
        '2. 模型可能需要特殊权限\n\n' +
        '【解决方案】\n' +
        '1. 检查 API 权限配置\n' +
        '2. 尝试使用其他模型'
      );
    }

    // 404 模型不存在
    if (errorStr.includes('404') || errorStr.includes('not_found')) {
      return new Error(
        '❌ 模型不存在\n\n' +
        '【可能原因】\n' +
        '1. 模型名称拼写错误\n' +
        '2. 该模型已下线或更名\n\n' +
        '【解决方案】\n' +
        '1. 检查模型名称是否正确\n' +
        '2. 推荐使用: imagen-3.0-generate-002'
      );
    }

    // 429 速率限制
    if (errorStr.includes('429') || errorStr.includes('resource_exhausted')) {
      return new Error(
        '⏳ API 配额或速率限制\n\n' +
        '【解决方案】\n' +
        '1. 稍后再试(等待 1-2 分钟)\n' +
        '2. 检查配额使用情况\n' +
        '3. 在设置中关闭「高并发模式」'
      );
    }

    // 安全过滤
    if (errorStr.includes('safety') || errorStr.includes('blocked')) {
      return new Error(
        '🛡️ 内容被安全过滤器拦截\n\n' +
        '【解决方案】\n' +
        '1. 修改提示词,使用更中性的描述\n' +
        '2. 避免涉及敏感话题\n' +
        '3. 尝试换一种表达方式'
      );
    }

    // 默认错误
    return new Error(
      `❌ API 调用失败\n\n` +
      `【原始错误】\n${errorOriginal.substring(0, 500)}\n\n` +
      '【通用解决方案】\n' +
      '1. 检查 API Key 是否正确配置\n' +
      '2. 检查网络连接是否正常\n' +
      '3. 尝试更换模型或简化提示词'
    );
  }

  getSupportedAspectRatios(): string[] {
    return ['1:1', '3:4', '4:3', '16:9', '9:16'];
  }
}