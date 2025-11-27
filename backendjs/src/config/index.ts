/**
 * 配置管理模块
 * 负责加载和管理系统配置,包括文本生成和图片生成服务商配置
 */
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { logger } from '../utils/logger';

/**
 * 服务商配置接口
 */
export interface ProviderConfig {
  type: string;
  api_key?: string;
  base_url?: string;
  model?: string;
  temperature?: number;
  max_output_tokens?: number;
  default_aspect_ratio?: string;
  default_size?: string;
  quality?: string;
  short_prompt?: boolean;
  high_concurrency?: boolean;
  endpoint_type?: string;
  image_size?: string;
  [key: string]: any;
}

/**
 * 配置文件接口
 */
export interface ProvidersConfig {
  active_provider: string;
  providers: { [key: string]: ProviderConfig };
}

/**
 * 配置管理类
 */
class Config {
  // 基础配置
  public readonly DEBUG: boolean = process.env.NODE_ENV !== 'production';
  public readonly HOST: string = process.env.HOST || '0.0.0.0';
  public readonly PORT: number = parseInt(process.env.PORT || '12398', 10);
  public readonly CORS_ORIGINS: string[] = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:3000').split(',');
  public readonly OUTPUT_DIR: string = process.env.OUTPUT_DIR || 'output';

  // 缓存的配置
  private _imageProvidersConfig: ProvidersConfig | null = null;
  private _textProvidersConfig: ProvidersConfig | null = null;

  /**
   * 获取项目根目录(backendjs目录)
   */
  private getRootDir(): string {
    // 开发环境: src/config -> backendjs
    // 生产环境: dist/config -> backendjs
    return process.cwd();
  }

  /**
   * 加载图片服务商配置
   */
  public loadImageProvidersConfig(): ProvidersConfig {
    if (this._imageProvidersConfig !== null) {
      return this._imageProvidersConfig;
    }

    const configPath = path.join(this.getRootDir(), 'image_providers.yaml');
    logger.debug(`加载图片服务商配置: ${configPath}`);

    if (!fs.existsSync(configPath)) {
      logger.warn(`图片配置文件不存在: ${configPath},使用默认配置`);
      this._imageProvidersConfig = {
        active_provider: 'google_genai',
        providers: {}
      };
      return this._imageProvidersConfig;
    }

    try {
      const fileContent = fs.readFileSync(configPath, 'utf8');
      this._imageProvidersConfig = yaml.load(fileContent) as ProvidersConfig || {
        active_provider: 'google_genai',
        providers: {}
      };
      logger.debug(`图片配置加载成功: ${Object.keys(this._imageProvidersConfig.providers).join(', ')}`);
      return this._imageProvidersConfig;
    } catch (error) {
      logger.error(`图片配置文件 YAML 格式错误: ${error}`);
      throw new Error(
        `配置文件格式错误: image_providers.yaml\n` +
        `YAML 解析错误: ${error}\n` +
        `解决方案:\n` +
        `1. 检查 YAML 缩进是否正确(使用空格,不要用Tab)\n` +
        `2. 检查引号是否配对\n` +
        `3. 使用在线 YAML 验证器检查格式`
      );
    }
  }

  /**
   * 加载文本服务商配置
   */
  public loadTextProvidersConfig(): ProvidersConfig {
    if (this._textProvidersConfig !== null) {
      return this._textProvidersConfig;
    }

    const configPath = path.join(this.getRootDir(), 'text_providers.yaml');
    logger.debug(`加载文本服务商配置: ${configPath}`);

    if (!fs.existsSync(configPath)) {
      logger.warn(`文本配置文件不存在: ${configPath},使用默认配置`);
      this._textProvidersConfig = {
        active_provider: 'google_gemini',
        providers: {}
      };
      return this._textProvidersConfig;
    }

    try {
      const fileContent = fs.readFileSync(configPath, 'utf8');
      this._textProvidersConfig = yaml.load(fileContent) as ProvidersConfig || {
        active_provider: 'google_gemini',
        providers: {}
      };
      logger.debug(`文本配置加载成功: ${Object.keys(this._textProvidersConfig.providers).join(', ')}`);
      return this._textProvidersConfig;
    } catch (error) {
      logger.error(`文本配置文件 YAML 格式错误: ${error}`);
      throw new Error(
        `配置文件格式错误: text_providers.yaml\n` +
        `YAML 解析错误: ${error}\n` +
        `解决方案:\n` +
        `1. 检查 YAML 缩进是否正确(使用空格,不要用Tab)\n` +
        `2. 检查引号是否配对\n` +
        `3. 使用在线 YAML 验证器检查格式`
      );
    }
  }

  /**
   * 获取激活的图片服务商
   */
  public getActiveImageProvider(): string {
    const config = this.loadImageProvidersConfig();
    const active = config.active_provider || 'google_genai';
    logger.debug(`当前激活的图片服务商: ${active}`);
    return active;
  }

  /**
   * 获取图片服务商配置
   */
  public getImageProviderConfig(providerName?: string): ProviderConfig {
    const config = this.loadImageProvidersConfig();

    if (!providerName) {
      providerName = this.getActiveImageProvider();
    }

    logger.info(`获取图片服务商配置: ${providerName}`);

    const providers = config.providers || {};
    if (Object.keys(providers).length === 0) {
      throw new Error(
        `未找到任何图片生成服务商配置。\n` +
        `解决方案:\n` +
        `1. 在系统设置页面添加图片生成服务商\n` +
        `2. 或手动编辑 image_providers.yaml 文件\n` +
        `3. 确保文件中有 providers 字段`
      );
    }

    if (!(providerName in providers)) {
      const available = Object.keys(providers).join(', ') || '无';
      logger.error(`图片服务商 [${providerName}] 不存在,可用服务商: ${available}`);
      throw new Error(
        `未找到图片生成服务商配置: ${providerName}\n` +
        `可用的服务商: ${available}\n` +
        `解决方案:\n` +
        `1. 在系统设置页面添加该服务商\n` +
        `2. 或修改 active_provider 为已存在的服务商\n` +
        `3. 检查 image_providers.yaml 文件`
      );
    }

    const providerConfig = { ...providers[providerName] };

    // 验证必要字段
    if (!providerConfig.api_key) {
      logger.error(`图片服务商 [${providerName}] 未配置 API Key`);
      throw new Error(
        `服务商 ${providerName} 未配置 API Key\n` +
        `解决方案:\n` +
        `1. 在系统设置页面编辑该服务商,填写 API Key\n` +
        `2. 或手动在 image_providers.yaml 中添加 api_key 字段`
      );
    }

    const providerType = providerConfig.type || providerName;
    if (['openai', 'openai_compatible', 'image_api'].includes(providerType)) {
      if (!providerConfig.base_url) {
        logger.error(`服务商 [${providerName}] 类型为 ${providerType},但未配置 base_url`);
        throw new Error(
          `服务商 ${providerName} 未配置 Base URL\n` +
          `服务商类型 ${providerType} 需要配置 base_url\n` +
          `解决方案:在系统设置页面编辑该服务商,填写 Base URL`
        );
      }
    }

    logger.info(`图片服务商配置验证通过: ${providerName} (type=${providerType})`);
    return providerConfig;
  }

  /**
   * 获取激活的文本服务商
   */
  public getActiveTextProvider(): string {
    const config = this.loadTextProvidersConfig();
    return config.active_provider || 'google_gemini';
  }

  /**
   * 获取文本服务商配置
   */
  public getTextProviderConfig(providerName?: string): ProviderConfig {
    const config = this.loadTextProvidersConfig();

    if (!providerName) {
      providerName = this.getActiveTextProvider();
    }

    const providers = config.providers || {};
    if (!(providerName in providers)) {
      const available = Object.keys(providers).join(', ') || '无';
      throw new Error(
        `未找到文本生成服务商配置: ${providerName}\n` +
        `可用的服务商: ${available}`
      );
    }

    return { ...providers[providerName] };
  }

  /**
   * 重新加载配置(清除缓存)
   */
  public reloadConfig(): void {
    logger.info('重新加载所有配置...');
    this._imageProvidersConfig = null;
    this._textProvidersConfig = null;
  }
}

// 导出单例实例
export const config = new Config();

/**
 * 便捷函数:加载文本配置
 */
export function loadTextConfig(): ProvidersConfig {
  return config.loadTextProvidersConfig();
}

/**
 * 便捷函数:加载图片配置
 */
export function loadImageConfig(): ProvidersConfig {
  return config.loadImageProvidersConfig();
}