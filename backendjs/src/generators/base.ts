/**
 * 图片生成器抽象基类
 */
import { ProviderConfig } from '../config';

/**
 * 图片生成器抽象基类
 */
export abstract class ImageGeneratorBase {
  protected config: ProviderConfig;
  protected apiKey?: string;
  protected baseUrl?: string;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.apiKey = config.api_key;
    this.baseUrl = config.base_url;
  }

  /**
   * 生成图片
   * @param kwargs 参数对象(包含prompt和其他参数)
   * @returns 图片二进制数据
   */
  abstract generateImage(
    kwargs: Record<string, any>
  ): Promise<Buffer>;

  /**
   * 验证配置是否有效
   * @returns 配置是否有效
   */
  abstract validateConfig(): boolean;

  /**
   * 获取支持的图片尺寸
   * @returns 支持的尺寸列表
   */
  getSupportedSizes(): string[] {
    return this.config.supported_sizes || ['1024x1024'];
  }

  /**
   * 获取支持的宽高比
   * @returns 支持的宽高比列表
   */
  getSupportedAspectRatios(): string[] {
    return this.config.supported_aspect_ratios || ['1:1', '3:4', '16:9'];
  }
}