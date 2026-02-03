import fs from 'fs';
import path from 'path';
import { getTempBaseDir, ensureDirectory } from './task-manager';

/**
 * 分块上传文件接口
 */
export interface ChunkedFileInfo {
  file_id: string;
  user_id: string;
  original_name: string;
  total_chunks: number;
  uploaded_chunks: number[];
  created_at: string;
  completed_at?: string;
  status: 'uploading' | 'completed' | 'expired';
}

/**
 * 获取上传临时目录
 */
export function getUploadsTempDir(): string {
  const baseDir = getTempBaseDir();
  ensureDirectory(baseDir);

  const uploadsDir = path.join(baseDir, 'uploads');
  ensureDirectory(uploadsDir);

  return uploadsDir;
}

/**
 * 获取用户上传目录
 */
export function getUserUploadDir(userId: string): string {
  const uploadsDir = getUploadsTempDir();
  const userDir = path.join(uploadsDir, userId);
  ensureDirectory(userDir);

  return userDir;
}

/**
 * 获取文件上传目录
 */
export function getFileUploadDir(userId: string, fileId: string): string {
  const userDir = getUserUploadDir(userId);
  const fileDir = path.join(userDir, fileId);
  ensureDirectory(fileDir);

  return fileDir;
}

/**
 * 获取文件块目录
 */
export function getChunksDir(userId: string, fileId: string): string {
  const fileDir = getFileUploadDir(userId, fileId);
  const chunksDir = path.join(fileDir, 'chunks');
  ensureDirectory(chunksDir);

  return chunksDir;
}

/**
 * 生成文件ID
 */
export function generateFileId(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const random = Math.random().toString(36).substring(2, 8);
  return `file_${timestamp}_${random}`;
}

/**
 * 初始化文件上传
 */
export function initFileUpload(userId: string, fileId: string, originalName: string, totalChunks: number): ChunkedFileInfo {
  const fileDir = getFileUploadDir(userId, fileId);
  const metadata: ChunkedFileInfo = {
    file_id: fileId,
    user_id: userId,
    original_name: originalName,
    total_chunks: totalChunks,
    uploaded_chunks: [],
    created_at: new Date().toISOString(),
    status: 'uploading',
  };

  // 保存元数据
  const metadataPath = path.join(fileDir, 'metadata.json');
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

  return metadata;
}

/**
 * 获取文件上传元数据
 */
export function getFileMetadata(userId: string, fileId: string): ChunkedFileInfo | null {
  const metadataPath = path.join(getFileUploadDir(userId, fileId), 'metadata.json');

  if (!fs.existsSync(metadataPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(metadataPath, 'utf-8');
    return JSON.parse(content) as ChunkedFileInfo;
  } catch (error) {
    console.error('读取文件元数据失败:', error);
    return null;
  }
}

/**
 * 保存文件块
 */
export function saveChunk(
  userId: string,
  fileId: string,
  chunkIndex: number,
  chunkData: Buffer
): { success: boolean; message: string } {
  try {
    const chunksDir = getChunksDir(userId, fileId);
    const chunkPath = path.join(chunksDir, `${chunkIndex}.chunk`);

    // 保存块文件
    fs.writeFileSync(chunkPath, chunkData);

    // 更新元数据
    const metadata = getFileMetadata(userId, fileId);
    if (!metadata) {
      return { success: false, message: '文件元数据不存在' };
    }

    if (!metadata.uploaded_chunks.includes(chunkIndex)) {
      metadata.uploaded_chunks.push(chunkIndex);
      metadata.uploaded_chunks.sort((a, b) => a - b);
    }

    // 保存更新后的元数据
    const metadataPath = path.join(getFileUploadDir(userId, fileId), 'metadata.json');
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

    return { success: true, message: `块 ${chunkIndex} 保存成功` };
  } catch (error) {
    console.error('保存文件块失败:', error);
    return { success: false, message: `保存块 ${chunkIndex} 失败: ${error}` };
  }
}

/**
 * 合并文件块
 */
export function mergeChunks(userId: string, fileId: string): { success: boolean; message: string; filePath?: string } {
  try {
    const metadata = getFileMetadata(userId, fileId);
    if (!metadata) {
      return { success: false, message: '文件元数据不存在' };
    }

    if (metadata.status !== 'uploading') {
      return { success: false, message: `文件状态错误: ${metadata.status}` };
    }

    // 检查所有块是否都已上传
    const missingChunks: number[] = [];
    for (let i = 0; i < metadata.total_chunks; i++) {
      if (!metadata.uploaded_chunks.includes(i)) {
        missingChunks.push(i);
      }
    }

    if (missingChunks.length > 0) {
      return { 
        success: false, 
        message: `缺少 ${missingChunks.length} 个块: [${missingChunks.join(', ')}]` 
      };
    }

    // 合并块
    const chunksDir = getChunksDir(userId, fileId);
    const fileDir = getFileUploadDir(userId, fileId);
    const mergedFilePath = path.join(fileDir, metadata.original_name);
    const writeStream = fs.createWriteStream(mergedFilePath);

    for (let i = 0; i < metadata.total_chunks; i++) {
      const chunkPath = path.join(chunksDir, `${i}.chunk`);
      const chunkData = fs.readFileSync(chunkPath);
      writeStream.write(chunkData);
    }

    writeStream.end();

    // 更新元数据
    metadata.status = 'completed';
    metadata.completed_at = new Date().toISOString();
    const metadataPath = path.join(fileDir, 'metadata.json');
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

    return { 
      success: true, 
      message: '文件合并成功',
      filePath: mergedFilePath
    };
  } catch (error) {
    console.error('合并文件块失败:', error);
    return { success: false, message: `合并失败: ${error}` };
  }
}

/**
 * 清理文件（包括块目录）
 */
export function cleanupFile(userId: string, fileId: string): void {
  try {
    const fileDir = getFileUploadDir(userId, fileId);
    if (fs.existsSync(fileDir)) {
      fs.rmSync(fileDir, { recursive: true, force: true });
    }
  } catch (error) {
    console.error('清理文件失败:', error);
  }
}

/**
 * 清理过期文件（超过指定时间未完成的文件）
 */
export function cleanupExpiredFiles(maxAgeHours: number = 24): void {
  try {
    const uploadsDir = getUploadsTempDir();
    const now = Date.now();
    const maxAgeMs = maxAgeHours * 60 * 60 * 1000;

    if (!fs.existsSync(uploadsDir)) {
      return;
    }

    // 遍历用户目录
    const userIds = fs.readdirSync(uploadsDir);
    for (const userId of userIds) {
      const userDir = path.join(uploadsDir, userId);
      if (!fs.statSync(userDir).isDirectory()) continue;

      // 遍历文件目录
      const fileIds = fs.readdirSync(userDir);
      for (const fileId of fileIds) {
        const fileDir = path.join(userDir, fileId);
        if (!fs.statSync(fileDir).isDirectory()) continue;

        const metadata = getFileMetadata(userId, fileId);
        if (!metadata) continue;

        // 检查是否过期
        const createdAt = new Date(metadata.created_at).getTime();
        if (now - createdAt > maxAgeMs) {
          console.log(`清理过期文件: ${fileId} (用户: ${userId})`);
          cleanupFile(userId, fileId);
        }
      }
    }
  } catch (error) {
    console.error('清理过期文件失败:', error);
  }
}

/**
 * 获取文件大小
 */
export function getFileSize(userId: string, fileId: string): number | null {
  try {
    const metadata = getFileMetadata(userId, fileId);
    if (!metadata || metadata.status !== 'completed') {
      return null;
    }

    const filePath = path.join(getFileUploadDir(userId, fileId), metadata.original_name);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    return fs.statSync(filePath).size;
  } catch (error) {
    console.error('获取文件大小失败:', error);
    return null;
  }
}

/**
 * 移动文件到任务目录
 */
export function moveFileToTask(
  userId: string,
  fileId: string,
  taskId: string,
  targetFileName?: string
): { success: boolean; filePath?: string; fileName?: string } {
  try {
    const metadata = getFileMetadata(userId, fileId);
    if (!metadata || metadata.status !== 'completed') {
      return { success: false };
    }

    const sourcePath = path.join(getFileUploadDir(userId, fileId), metadata.original_name);
    if (!fs.existsSync(sourcePath)) {
      return { success: false };
    }

    // 获取任务上传目录
    const tasksDir = path.join(getTempBaseDir(), 'tasks', userId, taskId, 'uploads');
    ensureDirectory(tasksDir);

    // 确定目标文件名
    const targetName = targetFileName || metadata.original_name;
    const targetPath = path.join(tasksDir, targetName);

    // 移动文件
    fs.renameSync(sourcePath, targetPath);

    // 清理临时目录
    cleanupFile(userId, fileId);

    return { 
      success: true,
      filePath: targetPath,
      fileName: targetName
    };
  } catch (error) {
    console.error('移动文件失败:', error);
    return { success: false };
  }
}
