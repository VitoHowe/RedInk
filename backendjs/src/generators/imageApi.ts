/**
 * Image API 图片生成器
 * 通用的图片生成 API 接口
 */
import axios, { AxiosInstance } from 'axios';
import { ImageGeneratorBase } from './base';
import { ProviderConfig } from '../config';
import { logger } from '../utils/logger';
import { compressImage } from '../utils/imageCompressor';

/**
 * Image API 生成器类
 */
export class ImageApiGenerator extends ImageGeneratorBase {
  private axios: AxiosInstance;
  private model: string;
  private defaultAspectRatio: string;
  private imageSize: string;
  private endpointType: string;

  constructor(config: ProviderConfig) {
    super(config);
    logger.debug('初始化 ImageApiGenerator...');

    this.baseUrl = (config.base_url || 'https://api.example.com')
      .replace(/\/+$/, '')
      .replace(/\/v1$/, '');
    this.model = config.model || 'default-model';
    this.defaultAspectRatio = config.default_aspect_ratio || '3:4';
    this.imageSize = config.image_size || '4K';

    // 支持自定义端点路径
    let endpoint = config.endpoint_type || '/v1/images/generations';
    // 兼容旧的简写格式
    if (endpoint === 'images') {
      endpoint = '/v1/images/generations';
    } else if (endpoint === 'chat') {
      endpoint = '/v1/chat/completions';
    }
    // 确保以 / 开头
    if (!endpoint.startsWith('/')) {
      endpoint = '/' + endpoint;
    }
    this.endpointType = endpoint;

    // 创建 axios 实例
    this.axios = axios.create({
      timeout: 300000,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    logger.info(
      `ImageApiGenerator 初始化完成: ` +
      `base_url=${this.baseUrl}, model=${this.model}, endpoint=${this.endpointType}`
    );
  }

  validateConfig(): boolean {
    if (!this.apiKey) {
      logger.error('Image API Key 未配置');
      throw new Error(
        'Image API Key 未配置。\n' +
        '解决方案：在系统设置页面编辑该服务商，填写 API Key'
      );
    }
    return true;
  }

  async generateImage(kwargs: Record<string, any>): Promise<Buffer> {
    this.validateConfig();

    const prompt = kwargs.prompt;
    const aspectRatio = kwargs.aspect_ratio || kwargs.aspectRatio || this.defaultAspectRatio;
    const model = kwargs.model || this.model;
    const referenceImage = kwargs.reference_image || kwargs.referenceImage;
    const referenceImages = kwargs.reference_images || kwargs.referenceImages;

    logger.info(`Image API 生成图片: model=${model}, aspect_ratio=${aspectRatio}, endpoint=${this.endpointType}`);

    // 根据端点类型选择不同的生成方式
    if (this.endpointType.includes('chat') || this.endpointType.includes('completions')) {
      return this.generateViaChatApi(prompt, aspectRatio, model, referenceImage, referenceImages);
    } else {
      return this.generateViaImagesApi(prompt, aspectRatio, model, referenceImage, referenceImages);
    }
  }

  /**
   * 通过 /v1/images/generations 端点生成图片
   */
  private async generateViaImagesApi(
    prompt: string,
    aspectRatio: string,
    model: string,
    referenceImage?: Buffer,
    referenceImages?: Buffer[]
  ): Promise<Buffer> {
    const payload: any = {
      model,
      prompt,
      response_format: 'b64_json',
      aspect_ratio: aspectRatio,
      image_size: this.imageSize
    };

    // 收集所有参考图片
    const allReferenceImages: Buffer[] = [];
    if (referenceImages && referenceImages.length > 0) {
      allReferenceImages.push(...referenceImages);
    }
    if (referenceImage && !allReferenceImages.includes(referenceImage)) {
      allReferenceImages.push(referenceImage);
    }

    // 如果有参考图片，添加到 image 数组
    if (allReferenceImages.length > 0) {
      logger.debug(`  添加 ${allReferenceImages.length} 张参考图片`);
      const imageUris: string[] = [];
      
      for (let idx = 0; idx < allReferenceImages.length; idx++) {
        const imgData = allReferenceImages[idx];
        const compressed = await compressImage(imgData, 200);
        logger.debug(`  参考图 ${idx}: ${imgData.length} -> ${compressed.length} bytes`);
        const base64Image = compressed.toString('base64');
        const dataUri = `data:image/png;base64,${base64Image}`;
        imageUris.push(dataUri);
      }

      payload.image = imageUris;

      const refCount = allReferenceImages.length;
      const enhancedPrompt = 
        `参考提供的 ${refCount} 张图片的风格（色彩、光影、构图、氛围），生成一张新图片。\n\n` +
        `新图片内容：${prompt}\n\n` +
        `要求：\n` +
        `1. 保持相似的色调和氛围\n` +
        `2. 使用相似的光影处理\n` +
        `3. 保持一致的画面质感\n` +
        `4. 如果参考图中有人物或产品，可以适当融入`;
      payload.prompt = enhancedPrompt;
    }

    const apiUrl = `${this.baseUrl}${this.endpointType}`;
    logger.debug(`  发送请求到: ${apiUrl}`);

    try {
      const response = await this.axios.post(apiUrl, payload);
      const result = response.data;

      logger.debug(`  API 响应: data 长度=${result.data?.length || 0}`);

      if (result.data && result.data.length > 0) {
        const item = result.data[0];

        if (item.b64_json) {
          let b64String = item.b64_json;
          if (b64String.startsWith('data:')) {
            b64String = b64String.split(',')[1];
          }
          const imageData = Buffer.from(b64String, 'base64');
          logger.info(`✅ Image API 图片生成成功: ${imageData.length} bytes`);
          return imageData;
        }
      }

      throw new Error(
        `图片数据提取失败：未找到 b64_json 数据。\n` +
        `API响应片段: ${JSON.stringify(result).substring(0, 500)}\n` +
        '可能原因：\n' +
        '1. API返回格式与预期不符\n' +
        '2. response_format 参数未生效\n' +
        '3. 该模型不支持 b64_json 格式'
      );

    } catch (error: any) {
      if (error.response) {
        const statusCode = error.response.status;
        const errorDetail = JSON.stringify(error.response.data).substring(0, 500);

        logger.error(`Image API 请求失败: status=${statusCode}, error=${errorDetail}`);

        throw new Error(
          `Image API 请求失败 (状态码: ${statusCode})\n` +
          `错误详情: ${errorDetail}\n` +
          `请求地址: ${apiUrl}\n` +
          '可能原因：\n' +
          '1. API密钥无效或已过期\n' +
          '2. 请求参数不符合API要求\n' +
          '3. API服务端错误\n' +
          '4. Base URL配置错误'
        );
      }
      throw error;
    }
  }

  /**
   * 通过 /v1/chat/completions 端点生成图片(支持流式调用)
   * 正确的流式处理流程:
   * 1. 解析每个chunk中的reasoning_content用于显示进度
   * 2. 当finish_reason="stop"时,从该chunk的content字段提取图片URL
   * 3. 下载并返回图片
   */
  private async generateViaChatApi(
    prompt: string,
    aspectRatio: string,
    model: string,
    referenceImage?: Buffer,
    referenceImages?: Buffer[]
  ): Promise<Buffer> {
    // 构建用户消息内容
    let userContent: any = prompt;

    // 收集所有参考图片
    const allReferenceImages: Buffer[] = [];
    if (referenceImages && referenceImages.length > 0) {
      allReferenceImages.push(...referenceImages);
    }
    if (referenceImage && !allReferenceImages.includes(referenceImage)) {
      allReferenceImages.push(referenceImage);
    }

    // 如果有参考图片，构建多模态消息
    if (allReferenceImages.length > 0) {
      logger.debug(`  添加 ${allReferenceImages.length} 张参考图片到 chat 消息`);
      const contentParts: any[] = [{ type: 'text', text: prompt }];

      for (let idx = 0; idx < allReferenceImages.length; idx++) {
        const imgData = allReferenceImages[idx];
        const compressed = await compressImage(imgData, 200);
        logger.debug(`  参考图 ${idx}: ${imgData.length} -> ${compressed.length} bytes`);
        const base64Image = compressed.toString('base64');
        contentParts.push({
          type: 'image_url',
          image_url: { url: `data:image/png;base64,${base64Image}` }
        });
      }

      userContent = contentParts;
    }

    const payload = {
      model,
      messages: [{ role: 'user', content: userContent }],
      max_tokens: 4096,
      temperature: 1.0,
      stream: true
    };

    const apiUrl = `${this.baseUrl}${this.endpointType}`;
    logger.info(`Chat API 流式生成图片: ${apiUrl}, model=${model}`);

    try {
      const response = await this.axios.post(apiUrl, payload, {
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
          `【请求地址】${apiUrl}\n` +
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
    return ['1K', '2K', '4K'];
  }

  getSupportedAspectRatios(): string[] {
    return ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
  }
}