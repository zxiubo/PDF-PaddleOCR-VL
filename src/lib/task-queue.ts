/**
 * 任务队列管理工具
 * 用于管理后台任务队列（pending/processing/completed）
 */

import fs from 'fs';
import path from 'path';

/**
 * 优先级枚举
 */
export enum TaskPriority {
  Low = 'low',
  Normal = 'normal',
  High = 'high'
}

/**
 * 任务状态枚举
 */
export enum TaskStatus {
  Pending = 'pending',
  Processing = 'processing',
  Completed = 'completed',
  Failed = 'failed'
}

/**
 * 文件状态枚举
 */
export enum FileStatus {
  Pending = 'pending',
  Processing = 'processing',
  Completed = 'completed',
  Failed = 'failed',
  Skipped = 'skipped'
}

/**
 * 文件处理状态接口
 */
export interface FileProcessingStatus {
  fileName: string;
  savedName: string;
  status: FileStatus;
  startedAt?: number;
  completedAt?: number;
  elapsedTime?: number;
  error?: string;
  retryCount?: number;
}

/**
 * 队列任务接口
 */
export interface QueueTask {
  id: string;
  user_id: string;
  name: string;
  priority: TaskPriority;
  files: string[];  // 文件路径列表
  template?: string;  // 模板路径
  useDefaultTemplate: boolean;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  elapsed_time?: number;
  status: TaskStatus;
  progress: number;  // 0-100
  records_count: number;
  error?: string;
  file_statuses?: FileProcessingStatus[];
  ocr_token?: string;
  ocr_api_url?: string;
  template_headers?: string[];
}

/**
 * 获取项目根目录
 */
function getProjectRoot(): string {
  if (process.env.COZE_WORKSPACE_PATH) {
    return process.env.COZE_WORKSPACE_PATH;
  }
  return process.cwd();
}

/**
 * 获取临时目录
 */
export function getTempDir(): string {
  const root = getProjectRoot();
  
  // 检查是否为只读文件系统
  const testDir = path.join(root, 'temp');
  try {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    fs.accessSync(testDir, fs.constants.W_OK);
    return testDir;
  } catch (err) {
    // 如果不可写，使用 /tmp/app-temp
    const fallbackDir = '/tmp/app-temp';
    if (!fs.existsSync(fallbackDir)) {
      fs.mkdirSync(fallbackDir, { recursive: true });
    }
    return fallbackDir;
  }
}

/**
 * 获取队列目录
 */
function getQueueDir(priority?: TaskPriority, status?: TaskStatus): string {
  const tempDir = getTempDir();
  const queueDir = path.join(tempDir, 'queue');
  
  if (!priority && !status) {
    return queueDir;
  }
  
  if (priority && status) {
    return path.join(queueDir, priority, status);
  }
  
  if (priority) {
    return path.join(queueDir, priority);
  }
  
  if (status) {
    return path.join(queueDir, status);
  }
  
  return queueDir;
}

/**
 * 初始化队列目录结构
 */
export function initQueueDirs(): void {
  const priorities = [TaskPriority.High, TaskPriority.Normal, TaskPriority.Low];
  const statuses = [TaskStatus.Pending, TaskStatus.Processing, TaskStatus.Completed];
  
  // 创建优先级目录
  priorities.forEach(priority => {
    statuses.forEach(status => {
      const dir = path.join(getQueueDir(), priority, status);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  });
}

/**
 * 添加任务到队列
 */
export function enqueueTask(task: QueueTask): void {
  initQueueDirs();
  
  const taskFile = path.join(getQueueDir(task.priority, TaskStatus.Pending), `${task.id}.json`);
  fs.writeFileSync(taskFile, JSON.stringify(task, null, 2), 'utf-8');
}

/**
 * 从队列中获取下一个任务（按优先级）
 */
export function dequeueTask(): QueueTask | null {
  initQueueDirs();
  
  const priorities = [TaskPriority.High, TaskPriority.Normal, TaskPriority.Low];
  
  for (const priority of priorities) {
    const pendingDir = getQueueDir(priority, TaskStatus.Pending);
    
    if (!fs.existsSync(pendingDir)) {
      continue;
    }
    
    const files = fs.readdirSync(pendingDir)
      .filter(f => f.endsWith('.json'))
      .sort((a, b) => {
        // 按创建时间排序
        const taskA = getTaskById(a.replace('.json', ''), priority, TaskStatus.Pending);
        const taskB = getTaskById(b.replace('.json', ''), priority, TaskStatus.Pending);
        if (!taskA || !taskB) return 0;
        return new Date(taskA.created_at).getTime() - new Date(taskB.created_at).getTime();
      });
    
    if (files.length > 0) {
      const taskId = files[0].replace('.json', '');
      return getTaskById(taskId, priority, TaskStatus.Pending);
    }
  }
  
  return null;
}

/**
 * 移动任务状态
 */
export function moveTask(taskId: string, fromStatus: TaskStatus, toStatus: TaskPriority | TaskStatus, priority?: TaskPriority): void {
  const taskPriority = priority || TaskPriority.Normal;
  const fromFile = path.join(getQueueDir(taskPriority, fromStatus), `${taskId}.json`);
  
  // toStatus 可能是 TaskPriority（移动到优先级队列的pending）或 TaskStatus（移动到状态目录）
  let toFile: string;
  if (toStatus === TaskPriority.Low || toStatus === TaskPriority.Normal || toStatus === TaskPriority.High) {
    toFile = path.join(getQueueDir(toStatus, TaskStatus.Pending), `${taskId}.json`);
  } else {
    toFile = path.join(getQueueDir(taskPriority, toStatus as TaskStatus), `${taskId}.json`);
  }
  
  if (fs.existsSync(fromFile)) {
    fs.renameSync(fromFile, toFile);
  }
}

/**
 * 根据ID获取任务
 */
export function getTaskById(taskId: string, priority?: TaskPriority, status?: TaskStatus): QueueTask | null {
  let searchDirs: string[] = [];
  
  if (priority && status) {
    searchDirs = [getQueueDir(priority, status)];
  } else if (priority) {
    searchDirs = [
      getQueueDir(priority, TaskStatus.Pending),
      getQueueDir(priority, TaskStatus.Processing),
      getQueueDir(priority, TaskStatus.Completed)
    ];
  } else {
    const priorities = [TaskPriority.High, TaskPriority.Normal, TaskPriority.Low];
    priorities.forEach(p => {
      searchDirs.push(getQueueDir(p, TaskStatus.Pending));
      searchDirs.push(getQueueDir(p, TaskStatus.Processing));
      searchDirs.push(getQueueDir(p, TaskStatus.Completed));
    });
  }
  
  for (const dir of searchDirs) {
    const taskFile = path.join(dir, `${taskId}.json`);
    if (fs.existsSync(taskFile)) {
      const data = fs.readFileSync(taskFile, 'utf-8');
      return JSON.parse(data);
    }
  }
  
  return null;
}

/**
 * 更新任务
 */
export function updateTask(task: QueueTask): void {
  initQueueDirs();
  
  const taskFile = path.join(getQueueDir(task.priority, task.status), `${task.id}.json`);
  fs.writeFileSync(taskFile, JSON.stringify(task, null, 2), 'utf-8');
}

/**
 * 删除任务
 */
export function deleteTask(taskId: string, userId: string): boolean {
  const task = getTaskById(taskId);
  if (!task || task.user_id !== userId) {
    return false;
  }
  
  const taskFile = path.join(getQueueDir(task.priority, task.status), `${taskId}.json`);
  if (fs.existsSync(taskFile)) {
    fs.unlinkSync(taskFile);
    return true;
  }
  
  return false;
}

/**
 * 获取用户的任务列表
 */
export function getUserTasks(userId: string, status?: TaskStatus): QueueTask[] {
  const tasks: QueueTask[] = [];
  const priorities = [TaskPriority.High, TaskPriority.Normal, TaskPriority.Low];
  
  priorities.forEach(priority => {
    const searchStatuses = status ? [status] : [TaskStatus.Pending, TaskStatus.Processing, TaskStatus.Completed];
    
    searchStatuses.forEach(s => {
      const dir = path.join(getQueueDir(priority), s);
      if (!fs.existsSync(dir)) return;
      
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
      files.forEach(file => {
        const taskFile = path.join(dir, file);
        const data = fs.readFileSync(taskFile, 'utf-8');
        const task: QueueTask = JSON.parse(data);
        
        if (task.user_id === userId) {
          tasks.push(task);
        }
      });
    });
  });
  
  // 按创建时间倒序排序
  return tasks.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

/**
 * 计算自动优先级
 */
export function calculateAutoPriority(fileCount: number): TaskPriority {
  if (fileCount >= 20) {
    return TaskPriority.High;
  } else if (fileCount >= 10) {
    return TaskPriority.Normal;
  }
  return TaskPriority.Low;
}

/**
 * 生成任务ID
 */
export function generateTaskId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 获取队列统计信息
 */
export function getQueueStats(): {
  pending: { high: number; normal: number; low: number };
  processing: { high: number; normal: number; low: number };
} {
  const stats = {
    pending: { high: 0, normal: 0, low: 0 },
    processing: { high: 0, normal: 0, low: 0 }
  };
  
  const priorities = [TaskPriority.High, TaskPriority.Normal, TaskPriority.Low];
  
  priorities.forEach(priority => {
    // Pending 统计
    const pendingDir = path.join(getQueueDir(priority), TaskStatus.Pending);
    if (fs.existsSync(pendingDir)) {
      stats.pending[priority] = fs.readdirSync(pendingDir).filter(f => f.endsWith('.json')).length;
    }
    
    // Processing 统计
    const processingDir = path.join(getQueueDir(priority), TaskStatus.Processing);
    if (fs.existsSync(processingDir)) {
      stats.processing[priority] = fs.readdirSync(processingDir).filter(f => f.endsWith('.json')).length;
    }
  });
  
  return stats;
}
