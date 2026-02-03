import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/user-manager';
import {
  generateTaskId,
  createTaskDirectory,
  saveTaskMetadata,
  readTaskMetadata,
  getTempBaseDir,
  type TaskMetadata,
} from '@/lib/task-manager';
import {
  getFileMetadata,
  moveFileToTask,
} from '@/lib/chunk-upload-manager';
import {
  enqueueTask,
  TaskPriority,
  type QueueTask,
  TaskStatus,
  initQueueDirs,
} from '@/lib/task-queue';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

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
 * 读取Excel模板表头
 */
async function readTemplateHeaders(templatePath: string): Promise<any> {
  const scriptPath = path.join(getProjectRoot(), 'scripts', 'get_template_headers.py');
  const { stdout, stderr } = await execAsync(`python3 "${scriptPath}" "${templatePath}"`, {
    cwd: getProjectRoot(),
  });
  if (stderr && !stdout) {
    throw new Error(`读取模板失败: ${stderr}`);
  }
  return JSON.parse(stdout);
}

/**
 * 任务提交API
 * POST /api/submit-task
 *
 * 请求参数（JSON）:
 * - file_ids: 文件ID列表
 * - template_file_id: 模板文件ID（可选）
 * - use_default_template: 是否使用默认模板（默认true）
 * - task_name: 任务名称（可选）
 * - priority: 手动指定优先级（可选）
 * - user_id: 用户ID（可选）
 *
 * 返回:
 * - success: 是否成功
 * - task_id: 任务ID
 * - is_background: 是否后台任务
 * - file_count: 文件数量
 * - message: 消息
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    console.log('[submit-task API] 收到的请求体:', JSON.stringify(body, null, 2));
    
    const {
      file_ids,
      template_file_id,
      use_default_template = true,
      task_name = '批量提取任务',
      task_id: externalTaskId,  // 继续上传时传递的任务ID
      priority,
      user_id: externalUserId,
      ocr_token,
      ocr_api_url,
    } = body;

    // 参数验证
    if (!file_ids || !Array.isArray(file_ids) || file_ids.length === 0) {
      return NextResponse.json(
        { success: false, message: '请至少选择一个文件' },
        { status: 400 }
      );
    }

    if (!ocr_token || !ocr_api_url) {
      return NextResponse.json(
        { success: false, message: '缺少OCR API配置' },
        { status: 400 }
      );
    }

    // 获取用户ID
    const userId = externalUserId || getCurrentUserId();
    if (!userId) {
      return NextResponse.json(
        { success: false, message: '用户未登录' },
        { status: 401 }
      );
    }

    // 检查文件数量，决定是否使用后台任务
    const FILE_THRESHOLD = parseInt(process.env.FILE_THRESHOLD || '5');
    const useBackgroundTask = file_ids.length > FILE_THRESHOLD;

    if (!useBackgroundTask) {
      // 文件数量 <= 阈值，建议使用现有的 SSE 处理方式
      return NextResponse.json(
        {
          success: false,
          message: `文件数量不超过${FILE_THRESHOLD}个，建议使用实时处理方式`,
          useBackground: false,
        },
        { status: 200 }
      );
    }

    // 创建任务或使用已有任务
    let taskId: string;
    let isNewTask = false;
    let existingTask: TaskMetadata | null = null;
    
    if (externalTaskId) {
      // 继续上传，使用已有任务
      taskId = externalTaskId;
      isNewTask = false;
      console.log('[submit-task API] 继续上传到已有任务:', taskId);
      
      // 验证任务是否存在且属于当前用户
      existingTask = await readTaskMetadata(taskId);
      if (!existingTask) {
        return NextResponse.json(
          { success: false, message: '任务不存在' },
          { status: 404 }
        );
      }
      
      if (existingTask.user_id !== userId) {
        return NextResponse.json(
          { success: false, message: '无权访问该任务' },
          { status: 403 }
        );
      }
      
      if (existingTask.status === 'processing') {
        return NextResponse.json(
          { success: false, message: '任务正在处理中，请等待完成' },
          { status: 400 }
        );
      }
    } else {
      // 创建新任务
      taskId = generateTaskId();
      isNewTask = true;
      console.log('[submit-task API] 创建新任务:', taskId);
      createTaskDirectory(taskId, userId);
    }
    
    const uploadsDir = path.join(getTempBaseDir(), 'tasks', userId, taskId, 'uploads');

    // 确保上传目录存在
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    // 移动文件到任务目录
    const savedFiles: string[] = [];
    const uploadFiles: any[] = [];

    for (const fileId of file_ids) {
      // 获取文件元数据
      const fileMetadata = getFileMetadata(userId, fileId);
      if (!fileMetadata) {
        return NextResponse.json(
          { success: false, message: `文件 ${fileId} 不存在或已过期` },
          { status: 404 }
        );
      }

      // 移动文件
      const moveResult = moveFileToTask(userId, fileId, taskId);
      if (!moveResult.success || !moveResult.filePath) {
        return NextResponse.json(
          { success: false, message: `移动文件 ${fileId} 失败` },
          { status: 500 }
        );
      }

      savedFiles.push(moveResult.filePath);
      uploadFiles.push({
        name: fileMetadata.original_name,
        size: moveResult.filePath ? (fs.statSync(moveResult.filePath).size) : 0,
        type: 'file',
      });
    }

    // 处理模板文件
    let templatePath: string | undefined;
    
    if (template_file_id) {
      // 用户上传了新模板，使用新模板
      const templateMetadata = getFileMetadata(userId, template_file_id);
      if (templateMetadata) {
        const moveResult = moveFileToTask(userId, template_file_id, taskId, `template_${templateMetadata.original_name}`);
        if (moveResult.success && moveResult.filePath) {
          templatePath = moveResult.filePath;
          uploadFiles.push({
            name: templateMetadata.original_name,
            size: fs.statSync(moveResult.filePath).size,
            type: 'template',
          });
        }
      }
    } else if (!isNewTask && use_default_template === false) {
      // 继续上传且不使用默认模板，查找任务已有模板
      const existingTask = await readTaskMetadata(taskId);
      if (existingTask && existingTask.upload_files) {
        const existingTemplate = existingTask.upload_files.find(f => f.type === 'template');
        if (existingTemplate && existingTemplate.saved_name) {
          templatePath = path.join(getTempBaseDir(), 'tasks', userId, taskId, 'uploads', existingTemplate.saved_name);
          console.log('[submit-task API] 使用任务已有模板:', templatePath);
        }
      }
    }
    // 否则使用默认模板（由后续逻辑处理）

    // 读取模板headers
    let templateHeaders: string[] = [];
    if (templatePath) {
      // 使用自定义模板
      const templateResult = await readTemplateHeaders(templatePath);
      templateHeaders = templateResult.headers || [];
    } else if (use_default_template) {
      // 使用默认模板
      const defaultTemplatePath = path.join(getProjectRoot(), 'assets', '个人信息提取结果-模板.xlsx');
      if (fs.existsSync(defaultTemplatePath)) {
        const defaultResult = await readTemplateHeaders(defaultTemplatePath);
        templateHeaders = defaultResult.headers || [];
      }
    } else if (!isNewTask && existingTask) {
      // 继续上传，尝试从已有任务中读取模板
      const existingTemplate = existingTask.upload_files?.find(f => f.type === 'template');
      if (existingTemplate && existingTemplate.saved_name) {
        const existingTemplatePath = path.join(getTempBaseDir(), 'tasks', userId, taskId, 'uploads', existingTemplate.saved_name);
        if (fs.existsSync(existingTemplatePath)) {
          const templateResult = await readTemplateHeaders(existingTemplatePath);
          templateHeaders = templateResult.headers || [];
        }
      }
    }

    // 使用用户选择的优先级，如果没有选择则默认为 normal
    const finalPriority = priority || TaskPriority.Normal;

    // 调试日志
    console.log('[submit-task] 文件数量:', file_ids.length);
    console.log('[submit-task] 用户优先级:', priority);
    console.log('[submit-task] 最终优先级:', finalPriority);

    // 创建或更新任务元数据
    const taskMetadata: TaskMetadata = isNewTask ? {
      id: taskId,
      user_id: userId,
      name: task_name,
      created_at: new Date().toISOString(),
      status: 'pending',
      upload_files: uploadFiles,
      records: [],
      records_count: 0,
      priority: finalPriority,
      is_background: true,
      message: `任务已提交到后台（${file_ids.length}个文件）`,
    } : {
      id: taskId,
      user_id: userId,
      name: task_name,
      created_at: existingTask!.created_at,
      status: 'pending',
      upload_files: [...(existingTask!.upload_files || []), ...uploadFiles],
      records: existingTask!.records || [],
      records_count: existingTask!.records_count || 0,
      priority: finalPriority,
      is_background: true,
      message: `继续上传任务（${file_ids.length}个新文件）`,
      result_files: existingTask!.result_files,
      validation_summary: existingTask!.validation_summary,
    };

    // 保存任务元数据
    saveTaskMetadata(taskId, userId, taskMetadata);

    // 创建队列任务
    initQueueDirs();
    const queueTask: QueueTask = {
      id: taskId,
      user_id: userId,
      name: task_name,
      priority: finalPriority,
      files: savedFiles,
      template: templatePath,
      useDefaultTemplate: use_default_template,
      created_at: taskMetadata.created_at,
      status: TaskStatus.Pending,
      progress: 0,
      records_count: existingTask?.records_count || 0,  // 继续上传时保留已有记录数
      ocr_token: ocr_token,
      ocr_api_url: ocr_api_url,
      template_headers: templateHeaders,  // 使用读取到的模板headers
    };

    // 添加到队列
    enqueueTask(queueTask);

    // 返回任务ID
    return NextResponse.json({
      success: true,
      message: '任务已提交到后台处理',
      task_id: taskId,
      is_background: true,
      priority: finalPriority,
      file_count: file_ids.length,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '提交任务失败';
    console.error('提交任务失败:', error);
    return NextResponse.json(
      { success: false, message: errorMessage },
      { status: 500 }
    );
  }
}
