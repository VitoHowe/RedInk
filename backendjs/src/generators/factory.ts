/**
 * 图片生成器工厂
 * 根据服务商类型创建对应的生成器实例
 */
import { ProviderConfig } from '../config';
import { ImageGeneratorBase } from './base';
import { GoogleGenAIGenerator } from './googleGenai';
import { OpenAICompatibleGenerator } from './openaiCompatible';
import { ImageApiGenerator } from './imageApi';

/**
 * 图片生成器工厂类
 */
export class ImageGeneratorFactory {
  // 注册的生成器类型
  private static readonly GENERATORS: Record<string, new (config: ProviderConfig) => ImageGeneratorBase> = {
    'google_genai': GoogleGenAIGenerator,
    'openai': OpenAICompatibleGenerator,
    'openai_compatible': OpenAICompatibleGenerator,
    'image_api': ImageApiGenerator,
  };

  /**
   * 创建图片生成器实例
   */
  static create(provider: string, config: ProviderConfig): ImageGeneratorBase {
    if (!(provider in this.GENERATORS)) {
      const available = Object.keys(this.GENERATORS).join(', ');
      throw new Error(
        `不支持的图片生成服务商: ${provider}\n` +
        `支持的服务商类型: ${available}\n` +
        `解决方案:\n` +
        `1. 检查 image_providers.yaml 中的 active_provider 配置\n` +
        `2. 确认 provider.type 字段是否正确\n` +
        `3. 或使用环境变量 IMAGE_PROVIDER 指定服务商`
      );
    }

    const GeneratorClass = this.GENERATORS[provider];
    return new GeneratorClass(config);
  }

  /**
   * 注册自定义生成器
   */
  static registerGenerator(
    name: string,
    generatorClass: new (config: ProviderConfig) => ImageGeneratorBase
  ): void {
    if (!(generatorClass.prototype instanceof ImageGeneratorBase)) {
      throw new TypeError(
        `注册失败：生成器类必须继承自 ImageGeneratorBase。\n` +
        `提供的类: ${generatorClass.name}\n` +
        `基类: ImageGeneratorBase`
      );
    }

    this.GENERATORS[name] = generatorClass;
  }
}