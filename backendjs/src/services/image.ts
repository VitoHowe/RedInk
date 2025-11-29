/**
 * 图片生成服务
 * 负责管理图片生成任务、并发控制、进度推送等
 */
import { logger } from '../utils/logger';
import { config } from '../config';
import { ImageGeneratorFactory } from '../generators/factory';
import { ImageGeneratorBase } from '../generators/base';
import { compressImage } from '../utils/imageCompressor';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { PageData } from './outline';

/**
 * 图片生成进度事件
 */
export interface ImageProgressEvent {
  event: 'progress' | 'complete' | 'error' | 'finish' | 'retry_start' | 'retry_finish';
  data: {
    index?: number;
    status?: string;
    message?: string;
    image_url?: string;
    current?: number;
    total?: number;
    phase?: string;
    success?: boolean;
    task_id?: string;
    images?: string[];
    completed?: number;
    failed?: number;
    failed_indices?: number[];
    retryable?: boolean;
    error?: string;
  };
}

/**
 * 任务状态
 */
interface TaskState {
  pages: PageData[];
  generated: { [index: number]: string };
  failed: { [index: number]: string };
  cover_image: Buffer | null;
  full_outline: string;
  user_images: Buffer[] | null;
  user_topic: string;
}

/**
 * 图片生成服务
 */
export class ImageService {
  // 并发配置
  private static readonly MAX_CONCURRENT = 15;
  private static readonly AUTO_RETRY_COUNT = 3;

  private generator: ImageGeneratorBase;
  private providerName: string;
  private providerConfig: any;
  private useShortPrompt: boolean;
  private promptTemplate: string;
  private promptTemplateShort: string;
  private historyRootDir: string;
  private currentTaskDir: string | null = null;
  private taskStates: Map<string, TaskState> = new Map();

  constructor(providerName?: string) {
    logger.debug('初始化 ImageService...');

    // 获取服务商配置
    if (!providerName) {
      providerName = config.getActiveImageProvider();
    }

    logger.info(`使用图片服务商: ${providerName}`);
    this.providerConfig = config.getImageProviderConfig(providerName);

    // 创建生成器实例
    const providerType = this.providerConfig.type || providerName;
    logger.debug(`创建生成器: type=${providerType}`);
    this.generator = ImageGeneratorFactory.create(providerType, this.providerConfig);

    // 保存配置信息
    this.providerName = providerName;

    // 检查是否启用短 prompt 模式
    this.useShortPrompt = this.providerConfig.short_prompt || false;

    // 加载提示词模板
    this.promptTemplate = this._loadPromptTemplate();
    this.promptTemplateShort = this._loadPromptTemplate(true);

    // 历史记录根目录
    this.historyRootDir = path.join(process.cwd(), 'history');
    if (!fs.existsSync(this.historyRootDir)) {
      fs.mkdirSync(this.historyRootDir, { recursive: true });
    }

    logger.info(`ImageService 初始化完成: provider=${providerName}, type=${providerType}`);
  }

  /**
   * 加载 Prompt 模板
   */
  private _loadPromptTemplate(short: boolean = false): string {
    const filename = short ? 'image_prompt_short.txt' : 'image_prompt.txt';
    const promptPath = path.join(process.cwd(), 'prompts', filename);
    
    if (!fs.existsSync(promptPath)) {
      return '';
    }
    
    return fs.readFileSync(promptPath, 'utf-8');
  }

  /**
   * 保存图片到本地，同时生成缩略图
   */
  private async _saveImage(imageData: Buffer, filename: string, taskDir?: string): Promise<string> {
    if (!taskDir) {
      taskDir = this.currentTaskDir!;
    }

    if (!taskDir) {
      throw new Error('任务目录未设置');
    }

    // 保存原图
    const filepath = path.join(taskDir, filename);
    fs.writeFileSync(filepath, imageData);

    // 生成缩略图（50KB左右）
    const thumbnailData = await compressImage(imageData, 50);
    const thumbnailFilename = `thumb_${filename}`;
    const thumbnailPath = path.join(taskDir, thumbnailFilename);
    fs.writeFileSync(thumbnailPath, thumbnailData);

    return filepath;
  }

  /**
   * 生成单张图片（带自动重试）
   */
  private async _generateSingleImage(
    page: PageData,
    taskId: string,
    referenceImage?: Buffer,
    retryCount: number = 0,
    fullOutline: string = '',
    userImages?: Buffer[],
    userTopic: string = ''
  ): Promise<[number, boolean, string | null, string | null]> {
    const index = page.index;
    const pageType = page.type;
    const pageContent = page.content;
    const maxRetries = ImageService.AUTO_RETRY_COUNT;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        logger.debug(`生成图片 [${index}]: type=${pageType}, attempt=${attempt + 1}/${maxRetries}`);

        // 根据配置选择模板
        let prompt: string;
        if (this.useShortPrompt && this.promptTemplateShort) {
          prompt = this.promptTemplateShort
            .replace('{page_content}', pageContent)
            .replace('{page_type}', pageType);
          logger.debug(`  使用短 prompt 模式 (${prompt.length} 字符)`);
        } else {
          prompt = this.promptTemplate
            .replace('{page_content}', pageContent)
            .replace('{page_type}', pageType)
            .replace('{full_outline}', fullOutline)
            .replace('{user_topic}', userTopic || '未提供');
        }

        // 调用生成器生成图片
        let imageData: Buffer;
        
        if (this.providerConfig.type === 'google_genai') {
          logger.debug('  使用 Google GenAI 生成器');
          imageData = await this.generator.generateImage({
            prompt,
            aspectRatio: this.providerConfig.default_aspect_ratio || '3:4',
            temperature: this.providerConfig.temperature || 1.0,
            model: this.providerConfig.model || 'gemini-3-pro-image-preview',
            referenceImage
          });
        } else if (this.providerConfig.type === 'image_api') {
          logger.debug('  使用 Image API 生成器');
          // Image API 支持多张参考图片
          const referenceImages: Buffer[] = [];
          if (userImages) {
            referenceImages.push(...userImages);
          }
          if (referenceImage) {
            referenceImages.push(referenceImage);
          }
          
          imageData = await this.generator.generateImage({
            prompt,
            aspectRatio: this.providerConfig.default_aspect_ratio || '3:4',
            temperature: this.providerConfig.temperature || 1.0,
            model: this.providerConfig.model || 'nano-banana-2',
            referenceImages: referenceImages.length > 0 ? referenceImages : undefined
          });
        } else {
          logger.debug('  使用 OpenAI 兼容生成器');
          imageData = await this.generator.generateImage({
            prompt,
            size: this.providerConfig.default_size || '1024x1024',
            model: this.providerConfig.model,
            quality: this.providerConfig.quality || 'standard'
          });
        }

        // 保存图片
        const filename = `${index}.png`;
        await this._saveImage(imageData, filename, this.currentTaskDir!);
        logger.info(`✅ 图片 [${index}] 生成成功: ${filename}`);

        return [index, true, filename, null];

      } catch (error: any) {
        const errorMsg = error.message || String(error);
        logger.warn(`图片 [${index}] 生成失败 (尝试 ${attempt + 1}/${maxRetries}): ${errorMsg.slice(0, 200)}`);

        if (attempt < maxRetries - 1) {
          const waitTime = Math.pow(2, attempt);
          logger.debug(`  等待 ${waitTime} 秒后重试...`);
          await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
          continue;
        }

        logger.error(`❌ 图片 [${index}] 生成失败，已达最大重试次数`);
        return [index, false, null, errorMsg];
      }
    }

    return [index, false, null, '超过最大重试次数'];
  }

  /**
   * 生成图片（生成器，支持 SSE 流式返回）
   */
  async *generateImages(
    pages: PageData[],
    taskId?: string,
    fullOutline: string = '',
    userImages?: Buffer[],
    userTopic: string = '',
    recordId?: string | null
  ): AsyncGenerator<ImageProgressEvent> {
    if (!taskId) {
      taskId = `task_${uuidv4().slice(0, 8)}`;
    }

    logger.info(`开始图片生成任务: task_id=${taskId}, pages=${pages.length}`);

    // 创建任务专属目录
    this.currentTaskDir = path.join(this.historyRootDir, taskId);
    if (!fs.existsSync(this.currentTaskDir)) {
      fs.mkdirSync(this.currentTaskDir, { recursive: true });
    }
    logger.debug(`任务目录: ${this.currentTaskDir}`);

    const total = pages.length;
    const generatedImages: string[] = [];
    const failedPages: PageData[] = [];
    let coverImageData: Buffer | null = null;

    // 压缩用户上传的参考图到200KB以内
    let compressedUserImages: Buffer[] | null = null;
    if (userImages && userImages.length > 0) {
      compressedUserImages = await Promise.all(
        userImages.map(async img => await compressImage(img, 200))
      );
    }

    // 初始化任务状态
    this.taskStates.set(taskId, {
      pages,
      generated: {},
      failed: {},
      cover_image: null,
      full_outline: fullOutline,
      user_images: compressedUserImages,
      user_topic: userTopic
    });

    // 引入历史服务用于实时更新
    const historyService = recordId ? (await import('./history')).getHistoryService() : null;

    // 立即保存 task_id 和状态
    if (historyService && recordId) {
      try {
        const record = historyService.getRecord(recordId);
        const currentImages = record?.images || { task_id: null, generated: [] };
        
        historyService.updateRecord(recordId, {
          status: 'generating',
          images: {
            ...currentImages,
            task_id: taskId
          }
        });
        logger.info(`已关联任务 ID 到记录: ${recordId} -> ${taskId}`);
      } catch (error: any) {
        logger.error(`关联任务 ID 失败: ${error.message}`);
      }
    }

    // ==================== 第一阶段：生成封面 ====================
    let coverPage: PageData | null = null;
    const otherPages: PageData[] = [];

    for (const page of pages) {
      if (page.type === 'cover') {
        coverPage = page;
      } else {
        otherPages.push(page);
      }
    }

    // 如果没有封面，使用第一页作为封面
    if (!coverPage && pages.length > 0) {
      coverPage = pages[0];
      otherPages.splice(0, 1);
    }

    if (coverPage) {
      // 发送封面生成进度
      yield {
        event: 'progress',
        data: {
          index: coverPage.index,
          status: 'generating',
          message: '正在生成封面...',
          current: 1,
          total,
          phase: 'cover'
        }
      };

      // 生成封面
      const [index, success, filename, error] = await this._generateSingleImage(
        coverPage,
        taskId,
        undefined,
        0,
        fullOutline,
        compressedUserImages || undefined,
        userTopic
      );

      if (success && filename) {
        generatedImages.push(filename);
        this.taskStates.get(taskId)!.generated[index] = filename;

        // 读取封面图片作为参考，并压缩到200KB以内
        const coverPath = path.join(this.currentTaskDir, filename);
        coverImageData = fs.readFileSync(coverPath);
        coverImageData = await compressImage(coverImageData, 200);
        this.taskStates.get(taskId)!.cover_image = coverImageData;

        // 实时更新历史记录:第一张图片生成后更新 thumbnail
        if (historyService && recordId) {
          try {
            const record = historyService.getRecord(recordId);
            const currentImages = record?.images || { task_id: taskId, generated: [] };
            const newGenerated = [...(currentImages.generated || [])];
            newGenerated[index] = filename;

            historyService.updateRecord(recordId, {
              thumbnail: filename,
              images: {
                ...currentImages,
                task_id: taskId,
                generated: newGenerated
              }
            });
            logger.debug(`✅ 已更新封面缩略图: thumbnail=${filename}`);
          } catch (error: any) {
            logger.error(`更新缩略图失败: ${error.message}`);
          }
        }

        yield {
          event: 'complete',
          data: {
            index,
            status: 'done',
            image_url: `/api/images/${taskId}/${filename}`,
            phase: 'cover'
          }
        };
      } else {
        failedPages.push(coverPage);
        this.taskStates.get(taskId)!.failed[index] = error || '未知错误';

        yield {
          event: 'error',
          data: {
            index: coverPage.index,
            status: 'error',
            message: error || '未知错误',
            retryable: true,
            phase: 'cover'
          }
        };
      }
    }

    // ==================== 第二阶段：生成其他页面 ====================
    if (otherPages.length > 0) {
      const highConcurrency = this.providerConfig.high_concurrency || false;

      if (highConcurrency) {
        // 高并发模式：并行生成
        yield {
          event: 'progress',
          data: {
            status: 'batch_start',
            message: `开始并发生成 ${otherPages.length} 页内容...`,
            current: generatedImages.length,
            total,
            phase: 'content'
          }
        };

        // 发送每个页面的进度
        for (const page of otherPages) {
          yield {
            event: 'progress',
            data: {
              index: page.index,
              status: 'generating',
              current: generatedImages.length + 1,
              total,
              phase: 'content'
            }
          };
        }

        // 并发生成（简化版，实际可以使用Promise.allSettled）
        const results = await Promise.allSettled(
          otherPages.map(page =>
            this._generateSingleImage(
              page,
              taskId,
              coverImageData || undefined,
              0,
              fullOutline,
              compressedUserImages || undefined,
              userTopic
            )
          )
        );

        for (let i = 0; i < results.length; i++) {
          const result = results[i];
          const page = otherPages[i];

          if (result.status === 'fulfilled') {
            const [index, success, filename, error] = result.value;
            
            if (success && filename) {
              generatedImages.push(filename);
              this.taskStates.get(taskId)!.generated[index] = filename;

              // 实时更新历史记录:每次生成成功后更新 generated 数组
              if (historyService && recordId) {
                try {
                  historyService.updateRecord(recordId, {
                    images: {
                      task_id: taskId,
                      generated: [...generatedImages]
                    }
                  });
                  logger.debug(`✅ 已更新生成列表: count=${generatedImages.length}`);
                } catch (error: any) {
                  logger.error(`更新生成列表失败: ${error.message}`);
                }
              }

              yield {
                event: 'complete',
                data: {
                  index,
                  status: 'done',
                  image_url: `/api/images/${taskId}/${filename}`,
                  phase: 'content'
                }
              };
            } else {
              failedPages.push(page);
              this.taskStates.get(taskId)!.failed[index] = error || '未知错误';

              yield {
                event: 'error',
                data: {
                  index,
                  status: 'error',
                  message: error || '未知错误',
                  retryable: true,
                  phase: 'content'
                }
              };
            }
          } else {
            failedPages.push(page);
            const errorMsg = result.reason?.message || String(result.reason);
            this.taskStates.get(taskId)!.failed[page.index] = errorMsg;

            yield {
              event: 'error',
              data: {
                index: page.index,
                status: 'error',
                message: errorMsg,
                retryable: true,
                phase: 'content'
              }
            };
          }
        }
      } else {
        // 顺序模式：逐个生成
        yield {
          event: 'progress',
          data: {
            status: 'batch_start',
            message: `开始顺序生成 ${otherPages.length} 页内容...`,
            current: generatedImages.length,
            total,
            phase: 'content'
          }
        };

        for (const page of otherPages) {
          yield {
            event: 'progress',
            data: {
              index: page.index,
              status: 'generating',
              current: generatedImages.length + 1,
              total,
              phase: 'content'
            }
          };

          const [index, success, filename, error] = await this._generateSingleImage(
            page,
            taskId,
            coverImageData || undefined,
            0,
            fullOutline,
            compressedUserImages || undefined,
            userTopic
          );

          if (success && filename) {
            generatedImages.push(filename);
            this.taskStates.get(taskId)!.generated[index] = filename;

            // 实时更新历史记录:每次生成成功后更新 generated 数组
            if (historyService && recordId) {
              try {
                historyService.updateRecord(recordId, {
                  images: {
                    task_id: taskId,
                    generated: [...generatedImages]
                  }
                });
                logger.debug(`✅ 已更新生成列表: count=${generatedImages.length}`);
              } catch (error: any) {
                logger.error(`更新生成列表失败: ${error.message}`);
              }
            }

            yield {
              event: 'complete',
              data: {
                index,
                status: 'done',
                image_url: `/api/images/${taskId}/${filename}`,
                phase: 'content'
              }
            };
          } else {
            failedPages.push(page);
            this.taskStates.get(taskId)!.failed[index] = error || '未知错误';

            yield {
              event: 'error',
              data: {
                index,
                status: 'error',
                message: error || '未知错误',
                retryable: true,
                phase: 'content'
              }
            };
          }
        }
      }
    }

    // ==================== 完成 ====================
    // 最终更新历史记录状态
    if (historyService && recordId) {
      try {
        let status: 'completed' | 'partial' | 'draft';
        if (failedPages.length === 0) {
          status = 'completed';
        } else if (generatedImages.length > 0) {
          status = 'partial';
        } else {
          status = 'draft';
        }

        historyService.updateRecord(recordId, {
          status,
          images: {
            task_id: taskId,
            generated: generatedImages
          }
        });
        logger.info(`✅ 已更新最终状态: status=${status}, generated=${generatedImages.length}`);
      } catch (error: any) {
        logger.error(`更新最终状态失败: ${error.message}`);
      }
    }

    yield {
      event: 'finish',
      data: {
        success: failedPages.length === 0,
        task_id: taskId,
        images: generatedImages,
        total,
        completed: generatedImages.length,
        failed: failedPages.length,
        failed_indices: failedPages.map(p => p.index)
      }
    };
  }

  /**
   * 重试生成单张图片
   */
  async retrySingleImage(
    taskId: string,
    page: PageData,
    useReference: boolean = true,
    fullOutline?: string,
    userTopic?: string
  ): Promise<{ success: boolean; index: number; image_url?: string; error?: string; retryable?: boolean }> {
    this.currentTaskDir = path.join(this.historyRootDir, taskId);
    if (!fs.existsSync(this.currentTaskDir)) {
      fs.mkdirSync(this.currentTaskDir, { recursive: true });
    }

    let referenceImage: Buffer | undefined;
    let userImages: Buffer[] | undefined;

    // 尝试从任务状态中获取上下文
    const taskState = this.taskStates.get(taskId);
    if (taskState) {
      if (useReference) {
        referenceImage = taskState.cover_image || undefined;
      }
      if (!fullOutline) {
        fullOutline = taskState.full_outline;
      }
      if (!userTopic) {
        userTopic = taskState.user_topic;
      }
      userImages = taskState.user_images || undefined;
    }

    // 如果任务状态中没有封面图，尝试从文件系统加载
    if (useReference && !referenceImage) {
      const coverPath = path.join(this.currentTaskDir, '0.png');
      if (fs.existsSync(coverPath)) {
        const coverData = fs.readFileSync(coverPath);
        referenceImage = await compressImage(coverData, 200);
      }
    }

    const [index, success, filename, error] = await this._generateSingleImage(
      page,
      taskId,
      referenceImage,
      0,
      fullOutline || '',
      userImages,
      userTopic || ''
    );

    if (success && filename) {
      if (taskState) {
        taskState.generated[index] = filename;
        delete taskState.failed[index];
      }

      return {
        success: true,
        index,
        image_url: `/api/images/${taskId}/${filename}`
      };
    } else {
      return {
        success: false,
        index,
        error: error || '未知错误',
        retryable: true
      };
    }
  }

  async *retrySingleImageStreaming(
    taskId: string,
    page: PageData,
    useReference: boolean = true,
    fullOutline?: string,
    userTopic?: string,
    recordId?: string | null
  ): AsyncGenerator<ImageProgressEvent> {
    logger.info(`流式重试单张图片: task_id=${taskId}, page=${page.index}`);

    this.currentTaskDir = path.join(this.historyRootDir, taskId);
    if (!fs.existsSync(this.currentTaskDir)) {
      fs.mkdirSync(this.currentTaskDir, { recursive: true });
    }

    let referenceImage: Buffer | undefined;
    let userImages: Buffer[] | undefined;

    // 尝试从任务状态中获取上下文
    const taskState = this.taskStates.get(taskId);
    if (taskState) {
      if (useReference) {
        referenceImage = taskState.cover_image || undefined;
      }
      if (!fullOutline) {
        fullOutline = taskState.full_outline;
      }
      if (!userTopic) {
        userTopic = taskState.user_topic;
      }
      userImages = taskState.user_images || undefined;
    }

    // 如果任务状态中没有封面图，尝试从文件系统加载
    if (useReference && !referenceImage) {
      const coverPath = path.join(this.currentTaskDir, '0.png');
      if (fs.existsSync(coverPath)) {
        const coverData = fs.readFileSync(coverPath);
        referenceImage = await compressImage(coverData, 200);
      }
    }

    // 发送开始事件
    yield {
      event: 'progress',
      data: {
        index: page.index,
        status: 'generating',
        message: `正在重新生成图片 [${page.index}]...`
      }
    };

    // 生成图片
    const [index, success, filename, error] = await this._generateSingleImage(
      page,
      taskId,
      referenceImage,
      0,
      fullOutline || '',
      userImages,
      userTopic || ''
    );

    if (success && filename) {
      if (taskState) {
        taskState.generated[index] = filename;
        delete taskState.failed[index];
      }

      // 实时更新历史记录
      if (recordId) {
        try {
          const historyService = (await import('./history')).getHistoryService();
          const record = historyService.getRecord(recordId);
          if (record) {
            const updatedGenerated = [...(record.images?.generated || [])];
            // 更新或添加当前图片
            const filenameOnly = filename;
            if (!updatedGenerated.includes(filenameOnly)) {
              updatedGenerated.push(filenameOnly);
            } else {
              // 替换已存在的
              const idx = updatedGenerated.indexOf(filenameOnly);
              updatedGenerated[idx] = filenameOnly;
            }
            
            historyService.updateRecord(recordId, {
              images: {
                task_id: taskId,
                generated: updatedGenerated
              }
            });
            logger.debug(`✅ 已更新重试图片: filename=${filename}`);
          }
        } catch (error: any) {
          logger.error(`更新重试图片失败: ${error.message}`);
        }
      }

      // 发送完成事件
      yield {
        event: 'complete',
        data: {
          index,
          status: 'done',
          image_url: `/api/images/${taskId}/${filename}`
        }
      };

      // 发送结束事件
      yield {
        event: 'finish',
        data: {
          success: true,
          index,
          image_url: `/api/images/${taskId}/${filename}`
        }
      };
    } else {
      if (taskState) {
        taskState.failed[index] = error || '未知错误';
      }

      // 发送错误事件
      yield {
        event: 'error',
        data: {
          index,
          status: 'error',
          message: error || '未知错误',
          retryable: true
        }
      };

      // 发送结束事件
      yield {
        event: 'finish',
        data: {
          success: false,
          index,
          error: error || '未知错误'
        }
      };
    }
  }

  /**
   * 批量重试失败的图片（生成器，支持 SSE 流式返回）
   */
  async *retryFailedImages(
    taskId: string,
    pages: PageData[]
  ): AsyncGenerator<ImageProgressEvent> {
    logger.info(`批量重试失败图片: task_id=${taskId}, pages=${pages.length}`);

    this.currentTaskDir = path.join(this.historyRootDir, taskId);
    if (!fs.existsSync(this.currentTaskDir)) {
      fs.mkdirSync(this.currentTaskDir, { recursive: true });
    }

    // 获取任务状态
    const taskState = this.taskStates.get(taskId);
    if (!taskState) {
      logger.warn(`任务 ${taskId} 状态不存在，使用默认值`);
    }

    let referenceImage: Buffer | undefined;
    let userImages: Buffer[] | undefined;
    const fullOutline = taskState?.full_outline || '';
    const userTopic = taskState?.user_topic || '';

    // 尝试加载封面作为参考图
    if (taskState?.cover_image) {
      referenceImage = taskState.cover_image;
    } else {
      const coverPath = path.join(this.currentTaskDir, '0.png');
      if (fs.existsSync(coverPath)) {
        const coverData = fs.readFileSync(coverPath);
        referenceImage = await compressImage(coverData, 200);
      }
    }

    if (taskState?.user_images) {
      userImages = taskState.user_images;
    }

    let successCount = 0;
    let failedCount = 0;

    // 依次重试每个失败的图片
    for (const page of pages) {
      yield {
        event: 'retry_start',
        data: {
          index: page.index,
          status: 'retrying',
          message: `重新生成失败的图片 [${page.index}]...`,
          current: successCount,
          total: pages.length
        }
      };

      const [index, success, filename, error] = await this._generateSingleImage(
        page,
        taskId,
        referenceImage,
        0,
        fullOutline,
        userImages,
        userTopic
      );

      if (success && filename) {
        successCount++;
        if (taskState) {
          taskState.generated[index] = filename;
          delete taskState.failed[index];
        }

        yield {
          event: 'retry_finish',
          data: {
            index,
            status: 'done',
            image_url: `/api/images/${taskId}/${filename}`,
            success: true
          }
        };
      } else {
        failedCount++;
        if (taskState) {
          taskState.failed[index] = error || '未知错误';
        }

        yield {
          event: 'error',
          data: {
            index,
            status: 'error',
            message: error || '未知错误',
            retryable: true
          }
        };
      }
    }

    // 发送完成信号
    yield {
      event: 'finish',
      data: {
        success: failedCount === 0,
        task_id: taskId,
        completed: successCount,
        failed: failedCount
      }
    };
  }

  /**
   * 获取图片完整路径
   */
  getImagePath(taskId: string, filename: string): string {
    const taskDir = path.join(this.historyRootDir, taskId);
    return path.join(taskDir, filename);
  }

  /**
   * 获取任务状态
   */
  getTaskState(taskId: string): TaskState | undefined {
    return this.taskStates.get(taskId);
  }

  /**
   * 清理任务状态（释放内存）
   */
  cleanupTask(taskId: string): void {
    this.taskStates.delete(taskId);
  }
}

/**
 * 全局服务实例
 */
let _serviceInstance: ImageService | null = null;

/**
 * 获取全局图片生成服务实例
 */
export function getImageService(): ImageService {
  if (!_serviceInstance) {
    _serviceInstance = new ImageService();
  }
  return _serviceInstance;
}

/**
 * 重置全局服务实例（配置更新后调用）
 */
export function resetImageService(): void {
  _serviceInstance = null;
}