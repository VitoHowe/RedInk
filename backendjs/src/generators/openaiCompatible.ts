/**
 * OpenAI 兼容接口图片生成器
 * 支持 DALL-E 和其他 OpenAI 格式的图片生成 API
 */
import axios, { AxiosInstance } from 'axios';
import { ImageGeneratorBase } from './base';
import { ProviderConfig } from '../config';
import { logger } from '../utils/logger';

/**
 * OpenAI 兼容生成器类
 */
export class OpenAICompatibleGenerator extends ImageGeneratorBase {
  private axios: AxiosInstance;
  private defaultModel: string;
  private endpointType: string;

  constructor(config: ProviderConfig) {
    super(config);
    logger.debug('初始化 OpenAICompatibleGenerator...');

    if (!this.apiKey) {
      logger.error('OpenAI 兼容 API Key 未配置');
      throw new Error(
        'OpenAI 兼容 API Key 未配置。\n' +
        '解决方案:在系统设置页面编辑该服务商,填写 API Key'
      );
    }

    if (!this.baseUrl) {
      logger.error('OpenAI 兼容 API Base URL 未配置');
      throw new Error(
        'OpenAI 兼容 API Base URL 未配置。\n' +
        '解决方案:在系统设置页面编辑该服务商,填写 Base URL'
      );
    }

    this.baseUrl = this.baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
    this.defaultModel = config.model || 'dall-e-3';

    let endpoint = config.endpoint_type || '/v1/images/generations';
    if (endpoint === 'images') {
      endpoint = '/v1/images/generations';
    } else if (endpoint === 'chat') {
      endpoint = '/v1/chat/completions';
    }
    this.endpointType = endpoint;

    this.axios = axios.create({
      timeout: 180000,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    logger.info(
      `OpenAICompatibleGenerator 初始化完成: ` +
      `base_url=${this.baseUrl}, model=${this.defaultModel}, endpoint=${this.endpointType}`
    );
  }

  validateConfig(): boolean {
    return !!(this.apiKey && this.baseUrl);
  }

  async generateImage(kwargs: Record<string, any>): Promise<Buffer> {
    const prompt = kwargs.prompt;
    const size = kwargs.size || '1024x1024';
    const model = kwargs.model || this.defaultModel;
    const quality = kwargs.quality || 'standard';

    logger.info(`OpenAI 兼容 API 生成图片: model=${model}, size=${size}, endpoint=${this.endpointType}`);

    if (this.endpointType.includes('chat') || this.endpointType.includes('completions')) {
      return this.generateViaChatApi(prompt, size, model);
    } else {
      return this.generateViaImagesApi(prompt, size, model, quality);
    }
  }

  private async generateViaImagesApi(
    prompt: string,
    size: string,
    model: string,
    quality: string
  ): Promise<Buffer> {
    const endpoint = this.endpointType.startsWith('/') ? this.endpointType : '/' + this.endpointType;
    const url = `${this.baseUrl}${endpoint}`;
    logger.debug(`  发送请求到: ${url}`);

    const payload: any = {
      model,
      prompt,
      n: 1,
      size,
      response_format: 'b64_json'
    };

    if (quality && model.startsWith('dall-e')) {
      payload.quality = quality;
    }

    try {
      const response = await this.axios.post(url, payload);
      const result = response.data;

      logger.debug(`  API 响应: data 长度=${result.data?.length || 0}`);

      if (result.data && result.data.length > 0) {
        const item = result.data[0];

        if (item.b64_json) {
          const imageData = Buffer.from(item.b64_json, 'base64');
          logger.info(`✅ OpenAI Images API 图片生成成功: ${imageData.length} bytes`);
          return imageData;
        } else if (item.url) {
          logger.debug(`  下载图片 URL...`);
          const imgResponse = await axios.get(item.url, { responseType: 'arraybuffer' });
          const imageData = Buffer.from(imgResponse.data);
          logger.info(`✅ OpenAI Images API 图片生成成功: ${imageData.length} bytes`);
          return imageData;
        }
      }

      throw new Error(
        'OpenAI API 未返回图片数据。\n' +
        `响应内容: ${JSON.stringify(result).substring(0, 500)}\n` +
        '可能原因:\n' +
        '1. 提示词被安全过滤拦截\n' +
        '2. 模型不支持图片生成\n' +
        '3. 请求格式不正确'
      );

    } catch (error: any) {
      if (error.response) {
        const statusCode = error.response.status;
        const errorDetail = JSON.stringify(error.response.data).substring(0, 500);

        logger.error(`OpenAI Images API 请求失败: status=${statusCode}, error=${errorDetail}`);

        throw new Error(
          `OpenAI Images API 请求失败 (状态码: ${statusCode})\n` +
          `错误详情: ${errorDetail}\n` +
          `请求地址: ${url}\n` +
          `模型: ${model}\n` +
          '可能原因:\n' +
          '1. API密钥无效或已过期\n' +
          '2. 模型名称不正确或无权访问\n' +
          '3. 请求参数不符合要求\n' +
          '4. API配额已用尽\n' +
          '5. Base URL配置错误'
        );
      }
      throw error;
    }
  }

  /**
   * 通过 chat API 端点生成图片(支持流式调用)
   * 正确的流式处理流程:
   * 1. 解析每个chunk中的reasoning_content用于显示进度
   * 2. 当finish_reason="stop"时,从该chunk的content字段提取图片URL
   * 3. 下载并返回图片
   */
  private async generateViaChatApi(
    prompt: string,
    size: string,
    model: string
  ): Promise<Buffer> {
    const endpoint = this.endpointType.startsWith('/') ? this.endpointType : '/' + this.endpointType;
    const url = `${this.baseUrl}${endpoint}`;
    logger.info(`Chat API 流式生成图片: ${url}, model=${model}`);

    const payload = {
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 4096,
      temperature: 1.0,
      stream: true
    };

    try {
      const response = await this.axios.post(url, payload, {
        responseType: 'stream'
      });

      let buffer = '';
      let chunkCount = 0;
      const MAX_CHUNKS = 200; // 最大接收次数限制
      
      return new Promise((resolve, reject) => {
        response.data.on('data', (chunk: Buffer) => {
          chunkCount++;
          
          // 超时检查：超过最大接收次数
          if (chunkCount > MAX_CHUNKS) {
            logger.error(`流式响应超时：已接收${chunkCount}次数据块，超过限制${MAX_CHUNKS}`);
            response.data.removeAllListeners('data');
            response.data.removeAllListeners('end');
            response.data.removeAllListeners('error');
            reject(new Error(
              `流式响应超时：接收次数超过${MAX_CHUNKS}次限制\n` +
              '可能原因：\n' +
              '1. API响应异常缓慢\n' +
              '2. 模型生成内容过长\n' +
              '3. 网络连接不稳定'
            ));
            return;
          }
          
          const chunkStr = chunk.toString();
          buffer += chunkStr;
          
          logger.debug(`收到数据块 #${chunkCount} (${chunkStr.length}字符), buffer累积: ${buffer.length}字符`);
          
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          
          for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine || trimmedLine === 'data: [DONE]') {
              continue;
            }
            
            try {
              // 移除 'data: ' 前缀
              let jsonStr = trimmedLine;
              if (jsonStr.startsWith('data: ')) {
                jsonStr = jsonStr.substring(6);
              }
              
              const parsed = JSON.parse(jsonStr);
              
              if (parsed.choices && parsed.choices.length > 0) {
                const choice = parsed.choices[0];
                const index = choice.index;
                
                const reasoningContent = choice.delta?.reasoning_content;
                if (reasoningContent) {
                  logger.info(`[进度 ${index}] ${reasoningContent.trim()}`);
                }
                
                if (choice.finish_reason === 'stop') {
                  logger.info(`✓ 检测到完成标记 (index ${index})`);
                  
                  const content = choice.delta?.content;
                  if (content) {
                    logger.info(`最终content内容:\n${content}`);
                    
                    // 立即移除所有事件监听器,停止接收后续数据
                    response.data.removeAllListeners('data');
                    response.data.removeAllListeners('end');
                    response.data.removeAllListeners('error');
                    
                    this.extractAndDownloadImage(content)
                      .then(imageData => resolve(imageData))
                      .catch(err => reject(err));
                    return;
                  } else {
                    reject(new Error('finish_reason=stop但未找到content字段'));
                    return;
                  }
                }
              }
            } catch (e) {
              logger.debug(`JSON解析失败: ${trimmedLine.substring(0, 80)}`);
            }
          }
        });
        
        response.data.on('end', () => {
          logger.error('流式响应结束但未收到完成标记');
          reject(new Error('流式响应异常结束,未收到finish_reason=stop'));
        });
        
        response.data.on('error', (error: Error) => {
          reject(error);
        });
      });

    } catch (error: any) {
      if (error.response) {
        const statusCode = error.response.status;
        const errorDetail = JSON.stringify(error.response.data).substring(0, 300);

        if (statusCode === 401) {
          throw new Error(
            '❌ API Key 认证失败\n\n' +
            '【可能原因】\n' +
            '1. API Key 无效或已过期\n' +
            '2. API Key 格式错误'
          );
        } else if (statusCode === 429) {
          throw new Error(
            '⏳ API 配额或速率限制\n\n' +
            '【解决方案】\n' +
            '1. 稍后再试\n' +
            '2. 检查 API 配额使用情况'
          );
        }

        throw new Error(
          `❌ Chat API 请求失败 (状态码: ${statusCode})\n\n` +
          `【错误详情】\n${errorDetail}\n\n` +
          `【请求地址】${url}\n` +
          `【模型】${model}`
        );
      }
      throw error;
    }
  }

  /**
   * 从content提取并下载图片
   */
  private async extractAndDownloadImage(content: string): Promise<Buffer> {
    logger.info('开始提取图片URL');
    
    const markdownRegex = /!\[.*?\]\((https?:\/\/[^\s\)]+)\)/g;
    const markdownMatches = [...content.matchAll(markdownRegex)];
    
    if (markdownMatches.length > 0) {
      logger.info(`从 Markdown 提取到 ${markdownMatches.length} 个图片URL`);
      const firstUrl = markdownMatches[0][1];
      logger.info(`下载第一张图片: ${firstUrl}`);
      return await this.downloadImage(firstUrl);
    }

    if (content.includes('data:image')) {
      logger.info('检测到 Base64 图片数据');
      const dataUrlMatch = content.match(/data:image\/[^;]+;base64,([A-Za-z0-9+/=]+)/);
      if (dataUrlMatch) {
        logger.info('解析Base64数据');
        return Buffer.from(dataUrlMatch[1], 'base64');
      }
    }

    const urlRegex = /(https?:\/\/[^\s]+\.(?:png|jpg|jpeg|gif|webp))/gi;
    const urlMatches = [...content.matchAll(urlRegex)];
    
    if (urlMatches.length > 0) {
      logger.info(`提取到 ${urlMatches.length} 个图片URL`);
      const firstUrl = urlMatches[0][1];
      logger.info(`下载第一张图片: ${firstUrl}`);
      return await this.downloadImage(firstUrl);
    }

    throw new Error(
      '❌ 无法从content中提取图片URL\n\n' +
      `【content内容】\n${content}\n\n` +
      '【可能原因】\n' +
      '1. content格式与预期不符\n' +
      '2. 图片URL格式未被识别'
    );
  }

  /**
   * 下载图片
   */
  private async downloadImage(url: string): Promise<Buffer> {
    logger.info(`下载图片: ${url.substring(0, 100)}...`);
    try {
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 60000
      });
      const imageData = Buffer.from(response.data);
      logger.info(`✅ 图片下载成功: ${imageData.length} bytes`);
      return imageData;
    } catch (error) {
      throw new Error(`❌ 下载图片失败: ${error}`);
    }
  }

  getSupportedSizes(): string[] {
    return this.config.supported_sizes || [
      '1024x1024',
      '1792x1024',
      '1024x1792',
      '2048x2048',
      '4096x4096'
    ];
  }
}