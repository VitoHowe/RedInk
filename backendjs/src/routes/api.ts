
/**
 * API 路由
 * 实现所有RESTful API端点
 */
import { Request, Response, Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import { logger } from '../utils/logger';
import { getOutlineService } from '../services/outline';
import { getImageService, resetImageService } from '../services/image';
import { getHistoryService } from '../services/history';
import { config } from '../config';
import yaml from 'js-yaml';
import archiver from 'archiver';

const router: Router = Router();

// 配置 multer 用于处理文件上传
const upload = multer({ storage: multer.memoryStorage() });

/**
 * 记录请求日志
 */
function logRequest(endpoint: string, data?: any): void {
  logger.info(`📥 收到请求: ${endpoint}`);
  if (data) {
    // 过滤敏感信息和大数据
    const safeData: any = {};
    for (const [key, value] of Object.entries(data)) {
      if (key === 'images' || key === 'user_images') {
        if (Array.isArray(value)) {
          safeData[key] = `[${value.length} 张图片]`;
        }
      } else if (!(value instanceof Buffer)) {
        safeData[key] = value;
      }
    }
    logger.debug(`  请求数据: ${JSON.stringify(safeData)}`);
  }
}

/**
 * 记录错误日志
 */
function logError(endpoint: string, error: Error): void {
  logger.error(`❌ 请求失败: ${endpoint}`);
  logger.error(`  错误类型: ${error.constructor.name}`);
  logger.error(`  错误信息: ${error.message}`);
  logger.debug(`  堆栈跟踪:\n${error.stack}`);
}

/**
 * 生成大纲（支持图片上传）
 */
router.post('/outline', upload.array('images'), async (req: Request, res: Response) => {
  const startTime = Date.now();
  try {
    let topic: string;
    let images: Buffer[] | undefined;

    // 检查是否是 multipart/form-data（带图片）
    if (req.is('multipart/form-data')) {
      topic = req.body.topic;
      // 获取上传的图片
      if (req.files && Array.isArray(req.files)) {
        images = req.files.map(file => file.buffer);
      }
      logRequest('/outline', { topic, images });
    } else {
      // JSON 请求（无图片或 base64 图片）
      const data = req.body;
      topic = data.topic;
      
      // 支持 base64 格式的图片
      const imagesBase64 = data.images || [];
      if (imagesBase64.length > 0) {
        images = [];
        for (const imgB64 of imagesBase64) {
          // 移除可能的 data URL 前缀
          let base64Data = imgB64;
          if (imgB64.includes(',')) {
            base64Data = imgB64.split(',')[1];
          }
          images.push(Buffer.from(base64Data, 'base64'));
        }
      }
      logRequest('/outline', { topic, images });
    }

    if (!topic) {
      logger.warn('大纲生成请求缺少 topic 参数');
      return res.status(400).json({
        success: false,
        error: '参数错误：topic 不能为空。\n请提供要生成图文的主题内容。'
      });
    }

    // 调用大纲生成服务
    logger.info(`🔄 开始生成大纲，主题: ${topic.slice(0, 50)}...`);
    const outlineService = getOutlineService();
    const result = await outlineService.generateOutline(topic, images);

    const elapsed = (Date.now() - startTime) / 1000;
    if (result.success) {
      logger.info(`✅ 大纲生成成功，耗时 ${elapsed.toFixed(2)}s，共 ${result.pages?.length || 0} 页`);
      return res.status(200).json(result);
    } else {
      logger.error(`❌ 大纲生成失败: ${result.error || '未知错误'}`);
      return res.status(500).json(result);
    }

  } catch (error: any) {
    logError('/outline', error);
    return res.status(500).json({
      success: false,
      error: `大纲生成异常。\n错误详情: ${error.message}\n建议：检查后端日志获取更多信息`
    });
  }
});

/**
 * 生成图片（SSE 流式返回，支持用户上传参考图片）
 */
router.post('/generate', async (req: Request, res: Response) => {
  try {
    const data = req.body;
    const pages = data.pages;
    const taskId = data.task_id;
    const fullOutline = data.full_outline || '';
    const userTopic = data.user_topic || '';
    
    // 支持 base64 格式的用户参考图片
    const userImagesBase64 = data.user_images || [];
    let userImages: Buffer[] | undefined;
    
    if (userImagesBase64.length > 0) {
      userImages = [];
      for (const imgB64 of userImagesBase64) {
        let base64Data = imgB64;
        if (imgB64.includes(',')) {
          base64Data = imgB64.split(',')[1];
        }
        userImages.push(Buffer.from(base64Data, 'base64'));
      }
    }

    logRequest('/generate', {
      pages_count: pages?.length || 0,
      task_id: taskId,
      user_topic: userTopic.slice(0, 50),
      user_images: userImages
    });

    if (!pages) {
      logger.warn('图片生成请求缺少 pages 参数');
      return res.status(400).json({
        success: false,
        error: '参数错误：pages 不能为空。\n请提供要生成的页面列表数据。'
      });
    }

    // 获取图片生成服务
    logger.info(`🖼️  开始图片生成任务: ${taskId}, 共 ${pages.length} 页`);
    const imageService = getImageService();

    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Connection', 'keep-alive');

    // SSE 生成器
    const generator = imageService.generateImages(
      pages,
      taskId,
      fullOutline,
      userImages,
      userTopic
    );

    for await (const event of generator) {
      const eventType = event.event;
      const eventData = event.data;

      // 格式化为 SSE 格式
      res.write(`event: ${eventType}\n`);
      res.write(`data: ${JSON.stringify(eventData)}\n\n`);
    }

    res.end();

  } catch (error: any) {
    logError('/generate', error);
    // SSE已经开始，不能返回JSON
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error: `图片生成异常。\n错误详情: ${error.message}\n建议：检查图片生成服务配置和后端日志`
      });
    }
  }
});

/**
 * 获取图片（支持缩略图）
 */
router.get('/images/:taskId/:filename', (req: Request, res: Response) => {
  try {
    const { taskId, filename } = req.params;
    logger.debug(`获取图片: ${taskId}/${filename}`);
    
    // 检查是否请求缩略图
    const thumbnail = req.query.thumbnail !== 'false';

    // 直接构建路径
    const historyRoot = path.join(process.cwd(), 'history');

    if (thumbnail) {
      // 尝试返回缩略图
      const thumbFilename = `thumb_${filename}`;
      const thumbFilepath = path.join(historyRoot, taskId, thumbFilename);

      // 如果缩略图存在，返回缩略图
      if (fs.existsSync(thumbFilepath)) {
        return res.sendFile(thumbFilepath);
      }
    }

    // 返回原图
    const filepath = path.join(historyRoot, taskId, filename);

    if (!fs.existsSync(filepath)) {
      return res.status(404).json({
        success: false,
        error: `图片不存在：${taskId}/${filename}`
      });
    }

    return res.sendFile(filepath);

  } catch (error: any) {
    logError('/images', error);
    return res.status(500).json({
      success: false,
      error: `获取图片失败: ${error.message}`
    });
  }
});

/**
 * 重试生成单张图片 - SSE 流式响应
 */
router.post('/retry', async (req: Request, res: Response) => {
  try {
    const data = req.body;
    const taskId = data.task_id;
    const page = data.page;
    const useReference = data.use_reference !== false;

    logRequest('/retry', { task_id: taskId, page_index: page?.index });

    if (!taskId || !page) {
      logger.warn('重试请求缺少必要参数');
      return res.status(400).json({
        success: false,
        error: '参数错误：task_id 和 page 不能为空。\n请提供任务ID和页面信息。'
      });
    }

    logger.info(`🔄 重试生成图片: task=${taskId}, page=${page.index}`);
    const imageService = getImageService();

    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Connection', 'keep-alive');

    // SSE 生成器
    const generator = imageService.retrySingleImageStreaming(
      taskId,
      page,
      useReference
    );

    for await (const event of generator) {
      const eventType = event.event;
      const eventData = event.data;

      // 格式化为 SSE 格式
      res.write(`event: ${eventType}\n`);
      res.write(`data: ${JSON.stringify(eventData)}\n\n`);
    }

    res.end();

  } catch (error: any) {
    logError('/retry', error);
    // SSE已经开始，不能返回JSON
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error: `重试图片生成失败。\n错误详情: ${error.message}`
      });
    }
  }
});

/**
 * 批量重试失败的图片（SSE 流式返回）
 */
router.post('/retry-failed', async (req: Request, res: Response) => {
  try {
    const data = req.body;
    const taskId = data.task_id;
    const pages = data.pages;

    logRequest('/retry-failed', { task_id: taskId, pages_count: pages?.length || 0 });

    if (!taskId || !pages) {
      logger.warn('批量重试请求缺少必要参数');
      return res.status(400).json({
        success: false,
        error: '参数错误：task_id 和 pages 不能为空。\n请提供任务ID和要重试的页面列表。'
      });
    }

    logger.info(`🔄 批量重试失败图片: task=${taskId}, 共 ${pages.length} 页`);
    const imageService = getImageService();

    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Connection', 'keep-alive');

    // SSE 生成器
    const generator = imageService.retryFailedImages(taskId, pages);

    for await (const event of generator) {
      const eventType = event.event;
      const eventData = event.data;

      // 格式化为 SSE 格式
      res.write(`event: ${eventType}\n`);
      res.write(`data: ${JSON.stringify(eventData)}\n\n`);
    }

    res.end();

  } catch (error: any) {
    logError('/retry-failed', error);
    // SSE已经开始，不能返回JSON
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error: `批量重试失败。\n错误详情: ${error.message}`
      });
    }
  }
});

/**
 * 重新生成图片（即使成功的也可以重新生成）- SSE 流式响应
 */
router.post('/regenerate', async (req: Request, res: Response) => {
  try {
    const data = req.body;
    const taskId = data.task_id;
    const page = data.page;
    const useReference = data.use_reference !== false;
    const fullOutline = data.full_outline || '';
    const userTopic = data.user_topic || '';

    logRequest('/regenerate', { task_id: taskId, page_index: page?.index });

    if (!taskId || !page) {
      logger.warn('重新生成请求缺少必要参数');
      return res.status(400).json({
        success: false,
        error: '参数错误：task_id 和 page 不能为空。\n请提供任务ID和页面信息。'
      });
    }

    logger.info(`🔄 重新生成图片: task=${taskId}, page=${page.index}`);
    const imageService = getImageService();

    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Connection', 'keep-alive');

    // SSE 生成器
    const generator = imageService.retrySingleImageStreaming(
      taskId,
      page,
      useReference,
      fullOutline,
      userTopic
    );

    for await (const event of generator) {
      const eventType = event.event;
      const eventData = event.data;

      // 格式化为 SSE 格式
      res.write(`event: ${eventType}\n`);
      res.write(`data: ${JSON.stringify(eventData)}\n\n`);
    }

    res.end();

  } catch (error: any) {
    logError('/regenerate', error);
    // SSE已经开始，不能返回JSON
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error: `重新生成图片失败。\n错误详情: ${error.message}`
      });
    }
  }
});

/**
 * 获取任务状态
 */
router.get('/task/:taskId', (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const imageService = getImageService();
    const state = imageService.getTaskState(taskId);

    if (!state) {
      return res.status(404).json({
        success: false,
        error: `任务不存在：${taskId}\n可能原因：\n1. 任务ID错误\n2. 任务已过期或被清理\n3. 服务重启导致状态丢失`
      });
    }

    // 不返回封面图片数据（太大）
    const safeState = {
      generated: state.generated,
      failed: state.failed,
      has_cover: state.cover_image !== null
    };

    return res.status(200).json({
      success: true,
      state: safeState
    });

  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: `获取任务状态失败。\n错误详情: ${error.message}`
    });
  }
});

/**
 * 健康检查
 */
router.get('/health', (req: Request, res: Response) => {
  return res.status(200).json({
    success: true,
    message: '服务正常运行'
  });
});

// ==================== 历史记录相关 API ====================

/**
 * 创建历史记录
 */
router.post('/history', async (req: Request, res: Response) => {
  try {
    const data = req.body;
    const topic = data.topic;
    const outline = data.outline;
    const taskId = data.task_id;

    if (!topic || !outline) {
      return res.status(400).json({
        success: false,
        error: '参数错误：topic 和 outline 不能为空。\n请提供主题和大纲内容。'
      });
    }

    const historyService = getHistoryService();
    const recordId = historyService.createRecord(topic, outline, taskId);

    return res.status(200).json({
      success: true,
      record_id: recordId
    });

  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: `创建历史记录失败。\n错误详情: ${error.message}`
    });
  }
});

/**
 * 获取历史记录列表
 */
router.get('/history', (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.page_size as string) || 20;
    const status = req.query.status as string | undefined;

    const historyService = getHistoryService();
    const result = historyService.listRecords(page, pageSize, status);

    return res.status(200).json({
      success: true,
      ...result
    });

  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: `获取历史记录列表失败。\n错误详情: ${error.message}`
    });
  }
});

/**
 * 获取历史记录详情
 */
router.get('/history/:recordId', (req: Request, res: Response) => {
  try {
    const { recordId } = req.params;
    const historyService = getHistoryService();
    const record = historyService.getRecord(recordId);

    if (!record) {
      return res.status(404).json({
        success: false,
        error: `历史记录不存在：${recordId}\n可能原因：记录已被删除或ID错误`
      });
    }

    return res.status(200).json({
      success: true,
      record
    });

  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: `获取历史记录详情失败。\n错误详情: ${error.message}`
    });
  }
});

/**
 * 更新历史记录
 */
router.put('/history/:recordId', (req: Request, res: Response) => {
  try {
    const { recordId } = req.params;
    const data = req.body;
    const outline = data.outline;
    const images = data.images;
    const status = data.status;
    const thumbnail = data.thumbnail;

    const historyService = getHistoryService();
    const success = historyService.updateRecord(recordId, {
      outline,
      images,
      status,
      thumbnail
    });

    if (!success) {
      return res.status(404).json({
        success: false,
        error: `更新历史记录失败：${recordId}\n可能原因：记录不存在或数据格式错误`
      });
    }

    return res.status(200).json({
      success: true
    });

  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: `更新历史记录失败。\n错误详情: ${error.message}`
    });
  }
});

/**
 * 删除历史记录
 */
router.delete('/history/:recordId', (req: Request, res: Response) => {
  try {
    const { recordId } = req.params;
    const historyService = getHistoryService();
    const success = historyService.deleteRecord(recordId);

    if (!success) {
      return res.status(404).json({
        success: false,
        error: `删除历史记录失败：${recordId}\n可能原因：记录不存在或ID错误`
      });
    }

    return res.status(200).json({
      success: true
    });

  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: `删除历史记录失败。\n错误详情: ${error.message}`
    });
  }
});

/**
 * 扫描单个任务并同步图片列表
 */
router.get('/history/scan/:taskId', (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const historyService = getHistoryService();
    const result = historyService.scanAndSyncTaskImages(taskId);

    if (!result.success) {
      return res.status(404).json(result);
    }

    return res.status(200).json(result);

  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: `扫描任务失败。\n错误详情: ${error.message}`
    });
  }
});

/**
 * 搜索历史记录
 */
router.get('/history/search', (req: Request, res: Response) => {
  try {
    const keyword = req.query.keyword as string || '';

    if (!keyword) {
      return res.status(400).json({
        success: false,
        error: '参数错误：keyword 不能为空。\n请提供搜索关键词。'
      });
    }

    const historyService = getHistoryService();
    const results = historyService.searchRecords(keyword);

    return res.status(200).json({
      success: true,
      records: results
    });

  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: `搜索历史记录失败。\n错误详情: ${error.message}`
    });
  }
});

/**
 * 获取历史记录统计
 */
router.get('/history/stats', (req: Request, res: Response) => {
  try {
    const historyService = getHistoryService();
    const stats = historyService.getStatistics();

    return res.json({
      success: true,
      ...stats
    });

  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: `获取历史记录统计失败。\n错误详情: ${error.message}`
    });
  }
});

/**
 * 扫描所有任务并同步图片列表
 */
router.post('/history/scan-all', (req: Request, res: Response) => {
  try {
    const historyService = getHistoryService();
    const result = historyService.scanAllTasks();

    if (!result.success) {
      return res.status(500).json(result);
    }

    return res.status(200).json(result);

  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: `扫描所有任务失败。\n错误详情: ${error.message}`
    });
  }
});

/**
 * 下载历史记录的所有图片为 ZIP 文件
 */
router.get('/history/:recordId/download', (req: Request, res: Response) => {
  try {
    const { recordId } = req.params;
    const historyService = getHistoryService();
    const record = historyService.getRecord(recordId);

    if (!record) {
      return res.status(404).json({
        success: false,
        error: `历史记录不存在：${recordId}`
      });
    }

    const taskId = record.images?.task_id;
    if (!taskId) {
      return res.status(404).json({
        success: false,
        error: '该记录没有关联的任务图片'
      });
    }

    // 获取任务目录
    const taskDir = path.join(process.cwd(), 'history', taskId);
    if (!fs.existsSync(taskDir)) {
      return res.status(404).json({
        success: false,
        error: `任务目录不存在：${taskId}`
      });
    }

    // 生成下载文件名
    const title = record.title || 'images';
    const safeTitle = title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5 \-_]/g, '').trim() || 'images';
    const filename = `${safeTitle}.zip`;

    // 设置响应头
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);

    // 创建 ZIP 流
    const archive = archiver('zip', {
      zlib: { level: 9 }
    });

    archive.on('error', (err) => {
      logger.error(`创建ZIP失败: ${err.message}`);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: `创建ZIP失败: ${err.message}`
        });
      }
    });

    // 管道输出到响应
    archive.pipe(res);

    // 遍历任务目录中的所有图片（排除缩略图）
    const files = fs.readdirSync(taskDir);
    for (const file of files) {
      // 跳过缩略图文件
      if (file.startsWith('thumb_')) {
        continue;
      }
      if (file.endsWith('.png') || file.endsWith('.jpg') || file.endsWith('.jpeg')) {
        const filePath = path.join(taskDir, file);
        // 使用 page_N.png 命名
        try {
          const index = parseInt(file.split('.')[0]);
          const archiveName = `page_${index + 1}.png`;
          archive.file(filePath, { name: archiveName });
        } catch {
          archive.file(filePath, { name: file });
        }
      }
    }

    // 完成归档
    archive.finalize();

  } catch (error: any) {
    logger.error(`下载失败: ${error.message}`);
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error: `下载失败。\n错误详情: ${error.message}`
      });
    }
  }
});

// ==================== 配置管理 API ====================

/**
 * 遮盖 API Key，只显示前4位和后4位
 */
function maskApiKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '*'.repeat(key.length);
  return key.slice(0, 4) + '*'.repeat(key.length - 8) + key.slice(-4);
}

/**
 * 准备返回给前端的 providers，返回脱敏的 api_key
 */
function prepareProvidersForResponse(providers: any): any {
  const result: any = {};
  for (const [name, providerConfig] of Object.entries<any>(providers)) {
    const providerCopy = { ...providerConfig };
    // 返回脱敏的 api_key
    if (providerCopy.api_key) {
      providerCopy.api_key_masked = maskApiKey(providerCopy.api_key);
      providerCopy.api_key = ''; // 不返回实际值
    } else {
      providerCopy.api_key_masked = '';
      providerCopy.api_key = '';
    }
    result[name] = providerCopy;
  }
  return result;
}

/**
 * 获取当前配置
 */
router.get('/config', (req: Request, res: Response) => {
  try {
    // 读取图片生成配置
    const imageConfigPath = path.join(process.cwd(), 'image_providers.yaml');
    let imageConfig: any;
    if (fs.existsSync(imageConfigPath)) {
      const content = fs.readFileSync(imageConfigPath, 'utf-8');
      imageConfig = yaml.load(content) || {};
    } else {
      imageConfig = {
        active_provider: 'google_genai',
        providers: {}
      };
    }

    // 读取文本生成配置
    const textConfigPath = path.join(process.cwd(), 'text_providers.yaml');
    let textConfig: any;
    if (fs.existsSync(textConfigPath)) {
      const content = fs.readFileSync(textConfigPath, 'utf-8');
      textConfig = yaml.load(content) || {};
    } else {
      textConfig = {
        active_provider: 'google_gemini',
        providers: {}
      };
    }

    return res.json({
      success: true,
      config: {
        text_generation: {
          active_provider: textConfig.active_provider || '',
          providers: prepareProvidersForResponse(textConfig.providers || {})
        },
        image_generation: {
          active_provider: imageConfig.active_provider || '',
          providers: prepareProvidersForResponse(imageConfig.providers || {})
        }
      }
    });

  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: `获取配置失败: ${error.message}`
    });
  }
});

/**
 * 更新配置
 */
router.post('/config', (req: Request, res: Response) => {
  try {
    const data = req.body;

    // 更新图片生成配置
    if (data.image_generation) {
      const imageConfigPath = path.join(process.cwd(), 'image_providers.yaml');
      
      // 读取现有配置
      let imageConfig: any;
      if (fs.existsSync(imageConfigPath)) {
        const content = fs.readFileSync(imageConfigPath, 'utf-8');
        imageConfig = yaml.load(content) || {};
      } else {
        imageConfig = { providers: {} };
      }

      const imageGenData = data.image_generation;
      if (imageGenData.active_provider !== undefined) {
        imageConfig.active_provider = imageGenData.active_provider;
      }

      if (imageGenData.providers) {
        const existingProviders = imageConfig.providers || {};
        const newProviders = imageGenData.providers;

        for (const [name, newConfig] of Object.entries<any>(newProviders)) {
          // 如果新配置的 api_key 是空，保留原有的
          if ([true, false, '', null, undefined].includes(newConfig.api_key)) {
            if (name in existingProviders && existingProviders[name].api_key) {
              newConfig.api_key = existingProviders[name].api_key;
            } else {
              delete newConfig.api_key;
            }
          }
          // 移除不需要保存的字段
          delete newConfig.api_key_env;
          delete newConfig.api_key_masked;
        }

        imageConfig.providers = newProviders;
      }

      // 保存配置
      fs.writeFileSync(imageConfigPath, yaml.dump(imageConfig, { noRefs: true }), 'utf-8');
    }

    // 更新文本生成配置
    if (data.text_generation) {
      const textConfigPath = path.join(process.cwd(), 'text_providers.yaml');
      
      // 读取现有配置
      let textConfig: any;
      if (fs.existsSync(textConfigPath)) {
        const content = fs.readFileSync(textConfigPath, 'utf-8');
        textConfig = yaml.load(content) || {};
      } else {
        textConfig = { providers: {} };
      }

      const textGenData = data.text_generation;
      if (textGenData.active_provider !== undefined) {
        textConfig.active_provider = textGenData.active_provider;
      }

      if (textGenData.providers) {
        const existingProviders = textConfig.providers || {};
        const newProviders = textGenData.providers;

        for (const [name, newConfig] of Object.entries<any>(newProviders)) {
          if ([true, false, '', null, undefined].includes(newConfig.api_key)) {
            if (name in existingProviders && existingProviders[name].api_key) {
              newConfig.api_key = existingProviders[name].api_key;
            } else {
              delete newConfig.api_key;
            }
          }
          delete newConfig.api_key_env;
          delete newConfig.api_key_masked;
        }

        textConfig.providers = newProviders;
      }

      // 保存配置
      fs.writeFileSync(textConfigPath, yaml.dump(textConfig, { noRefs: true }), 'utf-8');
    }

    // 清除配置缓存
    config.reloadConfig();

    // 清除 ImageService 缓存
    resetImageService();

    return res.json({
      success: true,
      message: '配置已保存'
    });

  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: `更新配置失败: ${error.message}`
    });
  }
});

/**
 * 测试服务商连接
 */
router.post('/config/test', async (req: Request, res: Response) => {
  try {
    const data = req.body;
    const providerType = data.type;
    const providerName = data.provider_name;
    const testConfig = {
      api_key: data.api_key,
      base_url: data.base_url,
      model: data.model
    };

    // 如果没有提供 api_key，从配置文件读取
    if (!testConfig.api_key && providerName) {
      let configPath: string;
      
      if (providerType === 'google_genai' || providerType === 'image_api') {
        configPath = path.join(process.cwd(), 'image_providers.yaml');
      } else {
        configPath = path.join(process.cwd(), 'text_providers.yaml');
      }

      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, 'utf-8');
        const yamlConfig = yaml.load(content) as any;
        const providers = yamlConfig?.providers || {};
        
        if (providerName in providers) {
          testConfig.api_key = providers[providerName].api_key;
          if (!testConfig.base_url) {
            testConfig.base_url = providers[providerName].base_url;
          }
          if (!testConfig.model) {
            testConfig.model = providers[providerName].model;
          }
        }
      }
    }

    if (!testConfig.api_key) {
      return res.status(400).json({ success: false, error: 'API Key 未配置' });
    }

    const testPrompt = '请回复\'你好，红墨\'';

    // 根据不同类型执行测试
    if (providerType === 'google_genai') {
      // 图片生成服务商：仅测试连接
      return res.json({
        success: true,
        message: 'Google GenAI 无法直接测试连接。请在实际生成图片时验证配置是否正确。'
      });

    } else if (providerType === 'openai_compatible' || providerType === 'image_api') {
      const baseUrl = (testConfig.base_url || 'https://api.openai.com').replace(/\/+$/, '').replace(/\/v1$/, '');

      if (providerType === 'image_api') {
        // 图片API：测试models端点
        try {
          const url = `${baseUrl}/v1/models`;
          const response = await axios.get(url, {
            headers: { 'Authorization': `Bearer ${testConfig.api_key}` },
            timeout: 30000
          });

          if (response.status === 200) {
            return res.json({
              success: true,
              message: '连接成功！仅代表连接稳定，不确定是否可以稳定支持图片生成'
            });
          } else {
            throw new Error(`HTTP ${response.status}: ${JSON.stringify(response.data).substring(0, 200)}`);
          }
        } catch (error: any) {
          return res.status(400).json({
            success: false,
            error: error.message || String(error)
          });
        }
      } else {
        // OpenAI兼容：实际调用文本生成测试
        try {
          const url = `${baseUrl}/v1/chat/completions`;
          const payload = {
            model: testConfig.model || 'gpt-3.5-turbo',
            messages: [{ role: 'user', content: testPrompt }],
            max_tokens: 50
          };

          const response = await axios.post(url, payload, {
            headers: {
              'Authorization': `Bearer ${testConfig.api_key}`,
              'Content-Type': 'application/json'
            },
            timeout: 30000
          });

          if (response.status !== 200) {
            throw new Error(`HTTP ${response.status}: ${JSON.stringify(response.data).substring(0, 200)}`);
          }

          const result = response.data;
          const resultText = result.choices[0].message.content;

          if (resultText.includes('你好') && resultText.includes('红墨')) {
            return res.json({
              success: true,
              message: `连接成功！响应: ${resultText.substring(0, 100)}`
            });
          } else {
            return res.json({
              success: true,
              message: `连接成功，但响应内容不符合预期: ${resultText.substring(0, 100)}`
            });
          }
        } catch (error: any) {
          return res.status(400).json({
            success: false,
            error: error.message || String(error)
          });
        }
      }

    } else if (providerType === 'google_gemini') {
      // Google Gemini文本生成测试
      return res.json({
        success: true,
        message: 'Google Gemini 无法直接测试连接。请在实际使用时验证配置是否正确。'
      });

    } else {
      return res.status(400).json({
        success: false,
        error: `不支持的类型: ${providerType}`
      });
    }

  } catch (error: any) {
    return res.status(400).json({
      success: false,
      error: error.message || String(error)
    });
  }
});

export default router;