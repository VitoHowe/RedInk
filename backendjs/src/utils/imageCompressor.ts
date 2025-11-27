/**
 * 图片压缩工具模块
 * 使用 sharp 库进行图片压缩和处理
 */
import sharp from 'sharp';
import { logger } from './logger';

/**
 * 压缩图片到指定大小以内
 * 
 * @param imageData 原始图片数据
 * @param maxSizeKb 最大文件大小(KB)
 * @param qualityStart 起始压缩质量(1-100)
 * @param qualityMin 最低压缩质量(1-100)
 * @param maxDimension 最大边长(像素)
 * @returns 压缩后的图片数据
 */
export async function compressImage(
  imageData: Buffer,
  maxSizeKb: number = 200,
  qualityStart: number = 85,
  qualityMin: number = 20,
  maxDimension: number = 2048
): Promise<Buffer> {
  const maxSizeBytes = maxSizeKb * 1024;

  // 如果原图已经小于目标大小,直接返回
  if (imageData.length <= maxSizeBytes) {
    return imageData;
  }

  try {
    // 获取图片信息
    const image = sharp(imageData);
    const metadata = await image.metadata();
    
    let width = metadata.width || 1024;
    let height = metadata.height || 1024;

    // 如果图片尺寸过大,先缩小
    if (width > maxDimension || height > maxDimension) {
      const ratio = Math.min(maxDimension / width, maxDimension / height);
      width = Math.floor(width * ratio);
      height = Math.floor(height * ratio);
    }

    // 逐步降低质量直到满足大小要求
    let quality = qualityStart;
    let compressedData: Buffer | null = null;

    while (quality >= qualityMin) {
      compressedData = await sharp(imageData)
        .resize(width, height, {
          fit: 'inside',
          withoutEnlargement: true
        })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();

      if (compressedData.length <= maxSizeBytes) {
        break;
      }

      quality -= 5;
    }

    // 如果还是太大,进一步缩小尺寸
    if (compressedData && compressedData.length > maxSizeBytes) {
      while (compressedData.length > maxSizeBytes && Math.max(width, height) > 512) {
        width = Math.floor(width * 0.9);
        height = Math.floor(height * 0.9);

        compressedData = await sharp(imageData)
          .resize(width, height, {
            fit: 'inside',
            withoutEnlargement: true
          })
          .jpeg({ quality: qualityMin, mozjpeg: true })
          .toBuffer();
      }
    }

    const originalSizeKb = imageData.length / 1024;
    const compressedSizeKb = (compressedData?.length || 0) / 1024;
    const compressionRatio = (1 - compressedSizeKb / originalSizeKb) * 100;

    logger.debug(
      `[图片压缩] ${originalSizeKb.toFixed(1)}KB → ${compressedSizeKb.toFixed(1)}KB ` +
      `(压缩 ${compressionRatio.toFixed(1)}%)`
    );

    return compressedData || imageData;
  } catch (error) {
    logger.warn(`[图片压缩] 压缩失败,返回原图: ${error}`);
    return imageData;
  }
}

/**
 * 批量压缩图片
 * 
 * @param images 图片数据列表
 * @param maxSizeKb 最大文件大小(KB)
 * @returns 压缩后的图片数据列表
 */
export async function compressImages(
  images: Buffer[],
  maxSizeKb: number = 200
): Promise<Buffer[]> {
  return Promise.all(images.map(img => compressImage(img, maxSizeKb)));
}