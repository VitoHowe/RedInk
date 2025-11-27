/**
 * 历史记录服务
 * 负责管理生成历史的存储、检索和管理
 */
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';

/**
 * 历史记录接口
 */
export interface HistoryRecord {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  outline: {
    outline: string;
    pages: any[];
    has_images?: boolean;
  };
  images: {
    task_id: string | null;
    generated: string[];
  };
  status: 'draft' | 'generating' | 'completed' | 'partial';
  thumbnail: string | null;
}

/**
 * 历史记录索引项
 */
export interface HistoryIndexRecord {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  status: string;
  thumbnail: string | null;
  page_count: number;
  task_id: string | null;
}

/**
 * 历史记录列表结果
 */
export interface HistoryListResult {
  records: HistoryIndexRecord[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

/**
 * 历史记录服务
 */
export class HistoryService {
  private historyDir: string;
  private indexFile: string;

  constructor() {
    this.historyDir = path.join(process.cwd(), 'history');
    if (!fs.existsSync(this.historyDir)) {
      fs.mkdirSync(this.historyDir, { recursive: true });
    }

    this.indexFile = path.join(this.historyDir, 'index.json');
    this._initIndex();
  }

  /**
   * 初始化索引文件
   */
  private _initIndex(): void {
    if (!fs.existsSync(this.indexFile)) {
      fs.writeFileSync(
        this.indexFile,
        JSON.stringify({ records: [] }, null, 2),
        'utf-8'
      );
    }
  }

  /**
   * 加载索引
   */
  private _loadIndex(): { records: HistoryIndexRecord[] } {
    try {
      const content = fs.readFileSync(this.indexFile, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      logger.error(`加载历史索引失败: ${error}`);
      return { records: [] };
    }
  }

  /**
   * 保存索引
   */
  private _saveIndex(index: { records: HistoryIndexRecord[] }): void {
    fs.writeFileSync(this.indexFile, JSON.stringify(index, null, 2), 'utf-8');
  }

  /**
   * 获取记录文件路径
   */
  private _getRecordPath(recordId: string): string {
    return path.join(this.historyDir, `${recordId}.json`);
  }

  /**
   * 创建历史记录
   */
  createRecord(
    topic: string,
    outline: any,
    taskId?: string
  ): string {
    const recordId = uuidv4();
    const now = new Date().toISOString();

    const record: HistoryRecord = {
      id: recordId,
      title: topic,
      created_at: now,
      updated_at: now,
      outline,
      images: {
        task_id: taskId || null,
        generated: []
      },
      status: 'draft',
      thumbnail: null
    };

    // 保存记录文件
    const recordPath = this._getRecordPath(recordId);
    fs.writeFileSync(recordPath, JSON.stringify(record, null, 2), 'utf-8');

    // 更新索引
    const index = this._loadIndex();
    index.records.unshift({
      id: recordId,
      title: topic,
      created_at: now,
      updated_at: now,
      status: 'draft',
      thumbnail: null,
      page_count: outline.pages?.length || 0,
      task_id: taskId || null
    });
    this._saveIndex(index);

    logger.info(`创建历史记录: ${recordId}`);
    return recordId;
  }

  /**
   * 获取历史记录
   */
  getRecord(recordId: string): HistoryRecord | null {
    const recordPath = this._getRecordPath(recordId);

    if (!fs.existsSync(recordPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(recordPath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      logger.error(`读取历史记录失败: ${recordId}, ${error}`);
      return null;
    }
  }

  /**
   * 更新历史记录
   */
  updateRecord(
    recordId: string,
    updates: {
      outline?: any;
      images?: any;
      status?: string;
      thumbnail?: string;
    }
  ): boolean {
    const record = this.getRecord(recordId);
    if (!record) {
      return false;
    }

    const now = new Date().toISOString();
    record.updated_at = now;

    if (updates.outline !== undefined) {
      record.outline = updates.outline;
    }

    if (updates.images !== undefined) {
      record.images = updates.images;
    }

    if (updates.status !== undefined) {
      record.status = updates.status as any;
    }

    if (updates.thumbnail !== undefined) {
      record.thumbnail = updates.thumbnail;
    }

    // 保存记录文件
    const recordPath = this._getRecordPath(recordId);
    fs.writeFileSync(recordPath, JSON.stringify(record, null, 2), 'utf-8');

    // 更新索引
    const index = this._loadIndex();
    const indexRecord = index.records.find(r => r.id === recordId);
    if (indexRecord) {
      indexRecord.updated_at = now;
      if (updates.status) {
        indexRecord.status = updates.status;
      }
      if (updates.thumbnail) {
        indexRecord.thumbnail = updates.thumbnail;
      }
      if (updates.outline) {
        indexRecord.page_count = updates.outline.pages?.length || 0;
      }
      if (updates.images?.task_id) {
        indexRecord.task_id = updates.images.task_id;
      }
    }
    this._saveIndex(index);

    logger.info(`更新历史记录: ${recordId}`);
    return true;
  }

  /**
   * 删除历史记录
   */
  deleteRecord(recordId: string): boolean {
    const record = this.getRecord(recordId);
    if (!record) {
      return false;
    }

    // 删除任务图片目录
    if (record.images?.task_id) {
      const taskDir = path.join(this.historyDir, record.images.task_id);
      if (fs.existsSync(taskDir)) {
        try {
          fs.rmSync(taskDir, { recursive: true, force: true });
          logger.info(`删除任务目录: ${taskDir}`);
        } catch (error) {
          logger.error(`删除任务目录失败: ${taskDir}, ${error}`);
        }
      }
    }

    // 删除记录文件
    const recordPath = this._getRecordPath(recordId);
    try {
      fs.unlinkSync(recordPath);
    } catch (error) {
      logger.error(`删除记录文件失败: ${recordId}, ${error}`);
      return false;
    }

    // 更新索引
    const index = this._loadIndex();
    index.records = index.records.filter(r => r.id !== recordId);
    this._saveIndex(index);

    logger.info(`删除历史记录: ${recordId}`);
    return true;
  }

  /**
   * 列出历史记录
   */
  listRecords(
    page: number = 1,
    pageSize: number = 20,
    status?: string
  ): HistoryListResult {
    const index = this._loadIndex();
    let records = index.records;

    if (status) {
      records = records.filter(r => r.status === status);
    }

    const total = records.length;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const pageRecords = records.slice(start, end);

    return {
      records: pageRecords,
      total,
      page,
      page_size: pageSize,
      total_pages: Math.ceil(total / pageSize)
    };
  }

  /**
   * 搜索历史记录
   */
  searchRecords(keyword: string): HistoryIndexRecord[] {
    const index = this._loadIndex();
    const keywordLower = keyword.toLowerCase();

    return index.records.filter(r =>
      r.title.toLowerCase().includes(keywordLower)
    );
  }

  /**
   * 获取统计信息
   */
  getStatistics(): { total: number; by_status: { [key: string]: number } } {
    const index = this._loadIndex();
    const records = index.records;

    const total = records.length;
    const byStatus: { [key: string]: number } = {};

    for (const record of records) {
      const status = record.status || 'draft';
      byStatus[status] = (byStatus[status] || 0) + 1;
    }

    return {
      total,
      by_status: byStatus
    };
  }

  /**
   * 扫描并同步任务图片
   */
  scanAndSyncTaskImages(taskId: string): any {
    const taskDir = path.join(this.historyDir, taskId);

    if (!fs.existsSync(taskDir) || !fs.statSync(taskDir).isDirectory()) {
      return {
        success: false,
        error: `任务目录不存在: ${taskId}`
      };
    }

    try {
      // 扫描目录下所有图片文件（排除缩略图）
      const imageFiles: string[] = [];
      const files = fs.readdirSync(taskDir);

      for (const filename of files) {
        // 跳过缩略图文件
        if (filename.startsWith('thumb_')) {
          continue;
        }
        if (filename.endsWith('.png') || filename.endsWith('.jpg') || filename.endsWith('.jpeg')) {
          imageFiles.push(filename);
        }
      }

      // 按文件名排序
      imageFiles.sort((a, b) => {
        const getIndex = (name: string): number => {
          try {
            return parseInt(name.split('.')[0]);
          } catch {
            return 999;
          }
        };
        return getIndex(a) - getIndex(b);
      });

      // 查找关联的历史记录
      const index = this._loadIndex();
      let recordId: string | null = null;

      for (const rec of index.records) {
        const recordDetail = this.getRecord(rec.id);
        if (recordDetail && recordDetail.images?.task_id === taskId) {
          recordId = rec.id;
          break;
        }
      }

      if (recordId) {
        // 更新历史记录
        const record = this.getRecord(recordId);
        if (record) {
          // 判断状态
          const expectedCount = record.outline.pages?.length || 0;
          const actualCount = imageFiles.length;

          let status: 'draft' | 'completed' | 'partial';
          if (actualCount === 0) {
            status = 'draft';
          } else if (actualCount >= expectedCount) {
            status = 'completed';
          } else {
            status = 'partial';
          }

          // 更新图片列表和状态
          this.updateRecord(recordId, {
            images: {
              task_id: taskId,
              generated: imageFiles
            },
            status,
            thumbnail: imageFiles.length > 0 ? imageFiles[0] : undefined
          });

          return {
            success: true,
            record_id: recordId,
            task_id: taskId,
            images_count: imageFiles.length,
            images: imageFiles,
            status
          };
        }
      }

      // 没有关联的记录
      return {
        success: true,
        task_id: taskId,
        images_count: imageFiles.length,
        images: imageFiles,
        no_record: true
      };

    } catch (error) {
      return {
        success: false,
        error: `扫描任务失败: ${error}`
      };
    }
  }

  /**
   * 扫描所有任务
   */
  scanAllTasks(): any {
    if (!fs.existsSync(this.historyDir)) {
      return {
        success: false,
        error: '历史记录目录不存在'
      };
    }

    try {
      let syncedCount = 0;
      let failedCount = 0;
      const orphanTasks: string[] = [];
      const results: any[] = [];

      // 遍历 history 目录
      const items = fs.readdirSync(this.historyDir);

      for (const item of items) {
        const itemPath = path.join(this.historyDir, item);

        // 只处理目录
        if (!fs.statSync(itemPath).isDirectory()) {
          continue;
        }

        const taskId = item;

        // 扫描并同步
        const result = this.scanAndSyncTaskImages(taskId);
        results.push(result);

        if (result.success) {
          if (result.no_record) {
            orphanTasks.push(taskId);
          } else {
            syncedCount++;
          }
        } else {
          failedCount++;
        }
      }

      return {
        success: true,
        total_tasks: results.length,
        synced: syncedCount,
        failed: failedCount,
        orphan_tasks: orphanTasks,
        results
      };

    } catch (error) {
      return {
        success: false,
        error: `扫描所有任务失败: ${error}`
      };
    }
  }
}

/**
 * 全局服务实例
 */
let _serviceInstance: HistoryService | null = null;

/**
 * 获取历史记录服务实例
 */
export function getHistoryService(): HistoryService {
  if (!_serviceInstance) {
    _serviceInstance = new HistoryService();
  }
  return _serviceInstance;
}