import { NextRequest } from 'next/server';
import { getTaskById } from '@/lib/task-queue';
import { readTaskMetadata } from '@/lib/task-manager';

/**
 * GET /api/tasks/[taskId]/status
 * 查询任务状态
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;
    const searchParams = request.nextUrl.searchParams;
    const userId = searchParams.get('user_id');

    if (!userId) {
      return Response.json({ 
        success: false, 
        message: '缺少用户ID' 
      }, { status: 400 });
    }

    // 从队列中查询任务
    const queueTask = getTaskById(taskId);
    
    // 从元数据中查询任务
    const taskMetadata = await readTaskMetadata(taskId);

    if (!queueTask && !taskMetadata) {
      return Response.json({ 
        success: false, 
        message: '任务不存在' 
      }, { status: 404 });
    }

    // 验证用户权限
    if (queueTask && queueTask.user_id !== userId) {
      return Response.json({ 
        success: false, 
        message: '无权访问该任务' 
      }, { status: 403 });
    }

    if (taskMetadata && taskMetadata.user_id !== userId) {
      return Response.json({ 
        success: false, 
        message: '无权访问该任务' 
      }, { status: 403 });
    }

    // 合并任务信息
    const status = {
      id: taskId,
      status: queueTask?.status || taskMetadata?.status || 'unknown',
      progress: queueTask?.progress || 0,
      records_count: queueTask?.records_count || taskMetadata?.records_count || 0,
      priority: queueTask?.priority || taskMetadata?.priority || 'normal',
      created_at: taskMetadata?.created_at || queueTask?.created_at,
      started_at: taskMetadata?.started_at || queueTask?.started_at,
      completed_at: taskMetadata?.completed_at || queueTask?.completed_at,
      elapsed_time: taskMetadata?.elapsed_time || queueTask?.elapsed_time,
      error: taskMetadata?.error || queueTask?.error,
      file_statuses: queueTask?.file_statuses,
      is_background: taskMetadata?.is_background || false,
      message: taskMetadata?.message || ''
    };

    return Response.json({
      success: true,
      task: status
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '查询任务状态失败';
    console.error('查询任务状态失败:', error);
    return Response.json({ 
      success: false, 
      message: errorMessage 
    }, { status: 500 });
  }
}
