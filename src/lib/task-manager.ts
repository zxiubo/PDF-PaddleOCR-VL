import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

/**
 * 获取项目根目录
 */
function getProjectRoot(): string {
  // 优先使用 COZE_WORKSPACE_PATH 环境变量
  if (process.env.COZE_WORKSPACE_PATH) {
    return process.env.COZE_WORKSPACE_PATH;
  }
  // 降级到 process.cwd()
  return process.cwd();
}

/**
 * 获取基础临时目录
 * 在部署环境中使用可写的临时目录（通常是 /tmp）
 * 
 * 重要：这个函数必须在所有进程中返回相同的值，否则会导致任务丢失
 */
export function getTempBaseDir(): string {
  // 优先使用 APP_TEMP_DIR 环境变量（这是保证一致性的关键）
  if (process.env.APP_TEMP_DIR) {
    return process.env.APP_TEMP_DIR;
  }
  
  // 如果没有设置环境变量，根据环境自动检测
  const cwd = process.cwd();
  const projectRoot = getProjectRoot();
  
  // 强制检测：如果项目根目录在 /opt/bytefaas 下，使用 /tmp/app-temp
  if (projectRoot.includes('/opt/bytefaas')) {
    console.warn('[TempDir] WARNING: APP_TEMP_DIR not set, auto-detecting /tmp/app-temp');
    return path.join('/tmp', 'app-temp');
  }

  // 如果当前工作目录在 /opt/bytefaas 下，使用 /tmp/app-temp
  if (cwd.includes('/opt/bytefaas')) {
    console.warn('[TempDir] WARNING: APP_TEMP_DIR not set, auto-detecting /tmp/app-temp');
    return path.join('/tmp', 'app-temp');
  }

  // 生产环境默认使用 /tmp/app-temp
  if (process.env.NODE_ENV === 'production') {
    console.warn('[TempDir] WARNING: APP_TEMP_DIR not set in production, using /tmp/app-temp');
    return path.join('/tmp', 'app-temp');
  }

  // 开发环境使用项目根目录下的 temp
  const tempDir = path.join(projectRoot, 'temp');
  return tempDir;
}

/**
 * 确保目录存在（带错误处理）
 */
export function ensureDirectory(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    try {
      fs.mkdirSync(dirPath, { recursive: true });
    } catch (error) {
      console.error(`创建目录失败: ${dirPath}`, error);
      throw new Error(`无法创建目录: ${dirPath}`);
    }
  }
}

/**
 * 获取任务基础目录
 */
export function getTasksBaseDir(): string {
  const baseDir = getTempBaseDir();
  ensureDirectory(baseDir);
  
  const tasksDir = path.join(baseDir, 'tasks');
  ensureDirectory(tasksDir);
  
  return tasksDir;
}

/**
 * 获取用户缓存目录
 */
export function getUserCacheDir(userId: string): string {
  const baseDir = getTempBaseDir();
  ensureDirectory(baseDir);
  
  const cacheBaseDir = path.join(baseDir, 'cache');
  ensureDirectory(cacheBaseDir);
  
  const cacheDir = path.join(cacheBaseDir, userId);
  ensureDirectory(cacheDir);
  
  return cacheDir;
}

/**
 * 任务元数据接口
 */
export interface TaskMetadata {
  id: string;
  user_id: string;  // 用户ID，用于数据隔离
  name: string;
  created_at: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  session_id?: string;  // 会话ID，用于LLM上下文管理
  upload_files: {
    name: string;
    saved_name?: string;  // 保存的文件名（用于下载）
    size: number;
    type: 'file' | 'template';
    file_hash?: string;  // 文件内容的哈希值（MD5）
  }[];
  records?: any[];  // 存储所有提取的记录数据
  result_files?: {
    excel: string;
    json: string;
  };
  records_count?: number;
  validation_summary?: {
    ok: number;
    warning: number;
    error: number;
  };
  message?: string;
  // 后台任务相关字段
  priority?: 'low' | 'normal' | 'high';  // 任务优先级
  started_at?: string;  // 任务开始时间
  completed_at?: string;  // 任务完成时间
  elapsed_time?: number;  // 任务耗时（毫秒）
  progress?: number;  // 任务进度（0-100）
  error?: string | null;  // 任务错误信息
  is_background?: boolean;  // 是否为后台任务
}

/**
 * 生成任务ID
 */
export function generateTaskId(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const random = Math.random().toString(36).substring(2, 5);
  return `task_${timestamp}_${random}`;
}

/**
 * 生成会话ID
 */
export function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * 创建任务并初始化会话
 */
export function createTaskWithSession(taskName: string, userId: string): { taskId: string; sessionId: string } {
  const taskId = generateTaskId();
  const sessionId = generateSessionId();

  const metadata: TaskMetadata = {
    id: taskId,
    user_id: userId,
    name: taskName,
    created_at: new Date().toISOString(),
    status: 'pending',
    session_id: sessionId,
    upload_files: [],
  };

  createTaskDirectory(taskId, userId);
  saveTaskMetadata(taskId, userId, metadata);

  return { taskId, sessionId };
}

/**
 * 创建任务目录
 */
export function createTaskDirectory(taskId: string, userId: string): string {
  const tasksDir = getTasksBaseDir();
  const userTaskDir = path.join(tasksDir, userId);
  const taskDir = path.join(userTaskDir, taskId);
  const uploadsDir = path.join(taskDir, 'uploads');
  const resultsDir = path.join(taskDir, 'results');

  ensureDirectory(userTaskDir);
  ensureDirectory(taskDir);
  ensureDirectory(uploadsDir);
  ensureDirectory(resultsDir);

  return taskDir;
}

/**
 * 保存任务元数据
 */
export function saveTaskMetadata(taskId: string, userId: string, metadata: TaskMetadata): void {
  const taskDir = path.join(getTasksBaseDir(), userId, taskId);
  const metadataPath = path.join(taskDir, 'task.json');

  fs.writeFileSync(
    metadataPath,
    JSON.stringify(metadata, null, 2),
    'utf-8'
  );
}

/**
 * 读取任务元数据
 */
export function readTaskMetadata(taskId: string, userId?: string): TaskMetadata | null {
  // 如果提供了 userId，使用它
  if (userId) {
    const metadataPath = path.join(getTasksBaseDir(), userId, taskId, 'task.json');
    if (fs.existsSync(metadataPath)) {
      try {
        const content = fs.readFileSync(metadataPath, 'utf-8');
        return JSON.parse(content);
      } catch (error) {
        console.error('读取任务元数据失败:', error);
        return null;
      }
    }
    return null;
  }

  // 如果没有提供 userId，遍历所有用户目录查找
  if (!fs.existsSync(getTasksBaseDir())) {
    return null;
  }

  const userDirs = fs.readdirSync(getTasksBaseDir(), { withFileTypes: true });
  
  for (const userDir of userDirs) {
    if (userDir.isDirectory()) {
      const metadataPath = path.join(getTasksBaseDir(), userDir.name, taskId, 'task.json');
      if (fs.existsSync(metadataPath)) {
        try {
          const content = fs.readFileSync(metadataPath, 'utf-8');
          return JSON.parse(content);
        } catch (error) {
          console.error('读取任务元数据失败:', error);
          return null;
        }
      }
    }
  }

  return null;
}

/**
 * 获取所有任务列表
 * @param userId 可选，如果提供则只返回该用户的任务
 */
export function getAllTasks(userId?: string): TaskMetadata[] {
  const tasksBaseDir = getTasksBaseDir();
  
  console.log(`[getAllTasks] Using tasks directory: ${tasksBaseDir}, userId: ${userId || 'all'}`);
  
  if (!fs.existsSync(tasksBaseDir)) {
    console.warn(`[getAllTasks] Tasks directory does not exist: ${tasksBaseDir}`);
    return [];
  }

  const tasks: TaskMetadata[] = [];

  // 如果指定了 userId，只遍历该用户的目录
  if (userId) {
    const userTaskDir = path.join(tasksBaseDir, userId);
    if (!fs.existsSync(userTaskDir)) {
      console.warn(`[getAllTasks] User task directory does not exist: ${userTaskDir}`);
      return [];
    }

    try {
      const taskDirs = fs.readdirSync(userTaskDir, { withFileTypes: true });
      console.log(`[getAllTasks] Found ${taskDirs.length} entries in user directory`);
      
      for (const dir of taskDirs) {
        if (dir.isDirectory()) {
          const metadata = readTaskMetadata(dir.name, userId);
          if (metadata) {
            tasks.push(metadata);
          }
        }
      }
    } catch (error) {
      console.error(`[getAllTasks] Error reading user directory ${userTaskDir}:`, error);
    }
  } else {
    // 遍历所有用户的目录
    try {
      const userDirs = fs.readdirSync(tasksBaseDir, { withFileTypes: true });
      console.log(`[getAllTasks] Found ${userDirs.length} user directories`);

      for (const userDir of userDirs) {
        if (userDir.isDirectory()) {
          const userTaskDir = path.join(tasksBaseDir, userDir.name);
          try {
            const taskDirs = fs.readdirSync(userTaskDir, { withFileTypes: true });

            for (const dir of taskDirs) {
              if (dir.isDirectory()) {
                const metadata = readTaskMetadata(dir.name, userDir.name);
                if (metadata) {
                  tasks.push(metadata);
                }
              }
            }
          } catch (error) {
            console.error(`[getAllTasks] Error reading task directory for user ${userDir.name}:`, error);
          }
        }
      }
    } catch (error) {
      console.error(`[getAllTasks] Error reading tasks base directory:`, error);
    }
  }

  console.log(`[getAllTasks] Returning ${tasks.length} tasks`);

  // 按创建时间降序排序
  return tasks.sort((a, b) => 
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

/**
 * 删除任务（包括队列数据清理）
 */
export function deleteTask(taskId: string, userId: string): boolean {
  const taskDir = path.join(getTasksBaseDir(), userId, taskId);

  if (!fs.existsSync(taskDir)) {
    return false;
  }

  try {
    // 递归删除整个任务目录
    fs.rmSync(taskDir, { recursive: true, force: true });
    
    // 删除队列中的任务数据
    const baseDir = getTempBaseDir();
    const queueDir = path.join(baseDir, 'queue');
    
    // 尝试从所有队列目录中删除任务
    const priorities = ['high', 'normal', 'low'];
    const statuses = ['pending', 'processing', 'completed'];
    
    priorities.forEach(priority => {
      statuses.forEach(status => {
        const queueFile = path.join(queueDir, priority, status, `${taskId}.json`);
        if (fs.existsSync(queueFile)) {
          fs.unlinkSync(queueFile);
        }
      });
    });
    
    // 删除用户缓存
    const cacheDir = getUserCacheDir(userId);
    const cacheFiles = fs.readdirSync(cacheDir);
    cacheFiles.forEach(cacheFile => {
      // 删除所有与该任务相关的缓存文件
      // 这里可以添加更精细的缓存清理逻辑
    });
    
    // 如果用户目录为空，也删除用户目录
    const userDir = path.join(getTasksBaseDir(), userId);
    try {
      const remainingFiles = fs.readdirSync(userDir);
      if (remainingFiles.length === 0) {
        fs.rmdirSync(userDir);
      }
    } catch (err) {
      // 忽略删除用户目录的错误
    }
    
    return true;
  } catch (error) {
    console.error('删除任务失败:', error);
    return false;
  }
}

/**
 * 获取任务目录路径
 */
export function getTaskDirectory(taskId: string, userId: string): string {
  return path.join(getTasksBaseDir(), userId, taskId);
}

/**
 * 获取任务上传目录
 */
export function getTaskUploadsDirectory(taskId: string, userId: string): string {
  return path.join(getTasksBaseDir(), userId, taskId, 'uploads');
}

/**
 * 获取任务结果目录
 */
export function getTaskResultsDirectory(taskId: string, userId: string): string {
  return path.join(getTasksBaseDir(), userId, taskId, 'results');
}

/**
 * 计算文件的MD5哈希值
 */
export function calculateFileHash(filePath: string): string {
  const hash = crypto.createHash('md5');
  const fileBuffer = fs.readFileSync(filePath);
  hash.update(fileBuffer);
  return hash.digest('hex');
}

/**
 * 计算Buffer的MD5哈希值
 */
export function calculateBufferHash(buffer: Buffer): string {
  const hash = crypto.createHash('md5');
  hash.update(buffer);
  return hash.digest('hex');
}

/**
 * 计算模板的哈希值（用于缓存）
 */
export function calculateTemplateHash(templatePath: string | undefined): string {
  let actualTemplatePath = templatePath;
  
  // 如果没有指定模板路径，使用默认模板
  if (!actualTemplatePath) {
    actualTemplatePath = path.join(getProjectRoot(), 'assets', '个人信息提取结果-模板.xlsx');
  }
  
  try {
    const hash = crypto.createHash('md5');
    const fileBuffer = fs.readFileSync(actualTemplatePath);
    hash.update(fileBuffer);
    return hash.digest('hex');
  } catch (error) {
    console.error('计算模板哈希失败:', error);
    return actualTemplatePath;  // 如果计算失败，使用路径作为唯一标识
  }
}

/**
 * 生成缓存文件名
 */
export function getCacheFileName(fileHash: string, templateHash: string): string {
  // 使用 文件哈希_模板哈希.json 作为文件名
  return `${fileHash}_${templateHash}.json`;
}

/**
 * 获取缓存文件路径
 */
export function getCacheFilePath(userId: string, fileHash: string, templateHash: string): string {
  const cacheDir = getUserCacheDir(userId);
  return path.join(cacheDir, getCacheFileName(fileHash, templateHash));
}

/**
 * 检查文件是否已解析（使用缓存）
 */
export function isFileParsed(
  userId: string,
  fileHash: string,
  templateHash: string
): any | null {
  const cacheFilePath = getCacheFilePath(userId, fileHash, templateHash);

  if (!fs.existsSync(cacheFilePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(cacheFilePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error('读取缓存失败:', error);
    return null;
  }
}

/**
 * 保存解析结果到缓存
 */
export function saveParsedRecord(
  userId: string,
  fileHash: string,
  templateHash: string,
  record: any
): void {
  const cacheFilePath = getCacheFilePath(userId, fileHash, templateHash);

  try {
    fs.writeFileSync(
      cacheFilePath,
      JSON.stringify(record, null, 2),
      'utf-8'
    );
  } catch (error) {
    console.error('保存缓存失败:', error);
  }
}

/**
 * 清理指定用户的缓存（可选功能）
 */
export function clearCache(userId: string): void {
  const cacheDir = getUserCacheDir(userId);
  
  if (!fs.existsSync(cacheDir)) {
    return;
  }

  try {
    const cacheFiles = fs.readdirSync(cacheDir);
    cacheFiles.forEach(file => {
      const filePath = path.join(cacheDir, file);
      if (fs.statSync(filePath).isFile()) {
        fs.unlinkSync(filePath);
      }
    });
  } catch (error) {
    console.error('清理缓存失败:', error);
  }
}

/**
 * 获取缓存统计信息
 */
export function getCacheStats(userId: string): { count: number; totalSize: number } {
  const cacheDir = getUserCacheDir(userId);
  
  if (!fs.existsSync(cacheDir)) {
    return { count: 0, totalSize: 0 };
  }

  let count = 0;
  let totalSize = 0;

  try {
    const cacheFiles = fs.readdirSync(cacheDir);
    cacheFiles.forEach(file => {
      const filePath = path.join(cacheDir, file);
      if (fs.statSync(filePath).isFile()) {
        const stats = fs.statSync(filePath);
        count++;
        totalSize += stats.size;
      }
    });
  } catch (error) {
    console.error('获取缓存统计失败:', error);
  }

  return { count, totalSize };
}

/**
 * 获取任务会话ID
 */
export function getTaskSessionId(taskId: string): string | null {
  const metadata = readTaskMetadata(taskId);
  return metadata?.session_id || null;
}

/**
 * 更新任务会话ID（如果需要重新创建会话）
 */
export function updateTaskSessionId(taskId: string, userId: string, sessionId: string): boolean {
  const metadata = readTaskMetadata(taskId, userId);
  if (!metadata) {
    return false;
  }

  metadata.session_id = sessionId;
  saveTaskMetadata(taskId, userId, metadata);
  return true;
}
