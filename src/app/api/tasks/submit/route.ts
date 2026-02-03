import { NextRequest } from 'next/server';
import { 
  generateTaskId, 
  createTaskDirectory, 
  getTaskUploadsDirectory,
  saveTaskMetadata,
  type TaskMetadata 
} from '@/lib/task-manager';
import {
  enqueueTask,
  TaskPriority,
  type QueueTask,
  TaskStatus,
  initQueueDirs
} from '@/lib/task-queue';
import fs from 'fs';
import path from 'path';

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
function getTempDir(): string {
  const root = getProjectRoot();
  
  const testDir = path.join(root, 'temp');
  try {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    fs.accessSync(testDir, fs.constants.W_OK);
    return testDir;
  } catch (err) {
    const fallbackDir = '/tmp/app-temp';
    if (!fs.existsSync(fallbackDir)) {
      fs.mkdirSync(fallbackDir, { recursive: true });
    }
    return fallbackDir;
  }
}

/**
 * POST /api/tasks/submit
 * 提交后台任务
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const userId = formData.get('user_id') as string;
    const uploadedFiles = formData.getAll('pdf_files') as File[];
    const templateFile = formData.get('template_file') as File | null;
    const useDefaultTemplate = formData.get('use_default_template') === 'true';
    const taskName = formData.get('task_name') as string || '批量提取任务';
    const priority = formData.get('priority') as TaskPriority | null;
    const ocrToken = formData.get('ocr_token') as string;
    const ocrApiUrl = formData.get('ocr_api_url') as string;

    // 验证参数
    if (!ocrToken || !ocrApiUrl) {
      return Response.json({ 
        success: false, 
        message: '缺少OCR API配置' 
      }, { status: 400 });
    }

    if (!uploadedFiles || uploadedFiles.length === 0) {
      return Response.json({ 
        success: false, 
        message: '请至少上传一个文件' 
      }, { status: 400 });
    }

    // 检查文件数量，决定是否使用后台任务
    const FILE_THRESHOLD = parseInt(process.env.FILE_THRESHOLD || '5');
    const useBackgroundTask = uploadedFiles.length > FILE_THRESHOLD;

    if (!useBackgroundTask) {
      // 文件数量 <= 阈值，建议使用现有的 SSE 处理方式
      return Response.json({ 
        success: false, 
        message: `文件数量不超过${FILE_THRESHOLD}个，建议使用实时处理方式`,
        useBackground: false
      }, { status: 200 });
    }

    // 创建任务
    const taskId = generateTaskId();
    createTaskDirectory(taskId, userId);
    const uploadsDir = getTaskUploadsDirectory(taskId, userId);

    // 保存上传的文件
    const savedFiles: string[] = [];
    for (const file of uploadedFiles) {
      const savedName = `${Date.now()}_${file.name}`;
      const filePath = path.join(uploadsDir, savedName);
      const buffer = Buffer.from(await file.arrayBuffer());
      fs.writeFileSync(filePath, buffer);
      savedFiles.push(filePath);
    }

    // 保存模板文件
    let templatePath: string | undefined;
    let templateHeaders: string[] = [];
    
    if (templateFile) {
      const templateFileName = `template_${Date.now()}.xlsx`;
      templatePath = path.join(uploadsDir, templateFileName);
      const buffer = Buffer.from(await templateFile.arrayBuffer());
      fs.writeFileSync(templatePath, buffer);
    }

    // 使用用户选择的优先级，如果没有选择则默认为 normal
    const finalPriority = priority || TaskPriority.Normal;

    // 创建任务元数据
    const taskMetadata: TaskMetadata = {
      id: taskId,
      user_id: userId,
      name: taskName,
      created_at: new Date().toISOString(),
      status: 'pending',
      upload_files: uploadedFiles.map(file => ({
        name: file.name,
        size: file.size,
        type: 'file' as const
      })),
      records: [],
      records_count: 0,
      priority: finalPriority,
      is_background: true,
      message: `任务已提交到后台（${uploadedFiles.length}个文件）`
    };

    // 保存任务元数据
    await saveTaskMetadata(taskId, userId, taskMetadata);

    // 创建队列任务
    initQueueDirs();
    const queueTask: QueueTask = {
      id: taskId,
      user_id: userId,
      name: taskName,
      priority: finalPriority,
      files: savedFiles,
      template: templatePath,
      useDefaultTemplate,
      created_at: taskMetadata.created_at,
      status: TaskStatus.Pending,
      progress: 0,
      records_count: 0,
      ocr_token: ocrToken,
      ocr_api_url: ocrApiUrl,
      template_headers: templateHeaders
    };

    // 添加到队列
    enqueueTask(queueTask);

    // 返回任务ID
    return Response.json({
      success: true,
      message: '任务已提交到后台处理',
      task_id: taskId,
      is_background: true,
      priority: finalPriority,
      file_count: uploadedFiles.length
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '提交任务失败';
    console.error('提交任务失败:', error);
    return Response.json({ 
      success: false, 
      message: errorMessage 
    }, { status: 500 });
  }
}
