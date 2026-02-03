import { NextRequest } from 'next/server';
import { getTaskById } from '@/lib/task-queue';
import { readTaskMetadata } from '@/lib/task-manager';
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
 * GET /api/tasks/[taskId]/stream
 * SSE 实时推送任务日志和状态更新
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;
  const searchParams = request.nextUrl.searchParams;
  const userId = searchParams.get('user_id');

  if (!userId) {
    return new Response(JSON.stringify({ success: false, message: '缺少用户ID' }), { 
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 查询任务元数据
  const taskMetadata = await readTaskMetadata(taskId);

  if (!taskMetadata) {
    return new Response(JSON.stringify({ success: false, message: '任务不存在' }), { 
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 验证用户权限
  if (taskMetadata.user_id !== userId) {
    return new Response(JSON.stringify({ success: false, message: '无权访问该任务' }), { 
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 检查是否为后台任务
  if (!taskMetadata.is_background) {
    return new Response(JSON.stringify({ success: false, message: '该任务不是后台任务，不支持SSE' }), { 
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 创建 SSE 流
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const logFile = path.join(getTempDir(), 'tasks', userId, taskId, 'progress.log');
      let lastLogSize = 0;
      let lastStatus = taskMetadata.status;
      let lastProgress = taskMetadata.progress || 0;
      let intervalId: NodeJS.Timeout | null = null;

      try {
        // 发送初始状态
        const sendInitialStatus = () => {
          try {
            const queueTask = getTaskById(taskId);
            const status = {
              type: 'status',
              status: queueTask?.status || taskMetadata.status,
              progress: queueTask?.progress ?? taskMetadata.progress ?? 0,
              records_count: queueTask?.records_count ?? taskMetadata.records_count ?? 0,
              error: taskMetadata.error ?? queueTask?.error
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(status)}\n\n`));
            
            // 如果任务已经完成或失败，不启动轮询，直接关闭连接
            if (status.status === 'completed' || status.status === 'failed') {
              setTimeout(() => {
                try {
                  controller.close();
                } catch (error) {
                  console.error('[SSE] 关闭连接失败:', error);
                }
              }, 500);
              return false; // 不启动轮询
            }
            return true; // 启动轮询
          } catch (error) {
            console.error('[SSE] 发送初始状态失败:', error);
            return false; // 不启动轮询
          }
        };

        // 检查日志变化
        const checkUpdates = async () => {
          try {
            // 检查任务状态变化
            const queueTask = getTaskById(taskId);
            const updatedMetadata = await readTaskMetadata(taskId);
            
            const currentStatus: 'pending' | 'processing' | 'completed' | 'failed' = 
              (queueTask?.status || updatedMetadata?.status) || 'pending';
            const currentProgress = queueTask?.progress ?? updatedMetadata?.progress ?? 0;
            
            if (currentStatus !== lastStatus || currentProgress !== lastProgress) {
              // 发送状态更新
              const statusUpdate = {
                type: 'status',
                status: currentStatus,
                progress: currentProgress,
                records_count: queueTask?.records_count ?? updatedMetadata?.records_count ?? 0,
                error: updatedMetadata?.error ?? queueTask?.error,
                elapsed_time: updatedMetadata?.elapsed_time ?? queueTask?.elapsed_time,
                completed_at: updatedMetadata?.completed_at
              };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(statusUpdate)}\n\n`));
              
              lastStatus = currentStatus;
              lastProgress = currentProgress;

              // 如果任务完成或失败，停止轮询
              if (currentStatus === 'completed' || currentStatus === 'failed') {
                if (intervalId) {
                  clearInterval(intervalId);
                  intervalId = null;
                }
                
                // 发送最后的状态后关闭连接
                setTimeout(() => {
                  try {
                    controller.close();
                  } catch (error) {
                    console.error('[SSE] 关闭连接失败:', error);
                  }
                }, 1000);
                return;
              }
            }

            // 检查日志文件变化
            if (fs.existsSync(logFile)) {
              try {
                const stats = fs.statSync(logFile);
                
                if (stats.size > lastLogSize) {
                  // 读取新增的日志内容
                  const buffer = Buffer.alloc(stats.size - lastLogSize);
                  const fd = fs.openSync(logFile, 'r');
                  fs.readSync(fd, buffer, 0, buffer.length, lastLogSize);
                  fs.closeSync(fd);
                  
                  const newContent = buffer.toString('utf-8');
                  const newLogs = newContent.split('\n').filter(line => line.trim() !== '');
                  
                  // 发送新日志
                  newLogs.forEach(logLine => {
                    const logUpdate = {
                      type: 'log',
                      message: logLine
                    };
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(logUpdate)}\n\n`));
                  });
                  
                  lastLogSize = stats.size;
                }
              } catch (error) {
                console.error('[SSE] 读取日志文件失败:', error);
              }
            }

          } catch (error) {
            console.error('[SSE] 检查更新失败:', error);
          }
        };

        // 立即发送初始状态
        const shouldStartPolling = sendInitialStatus();
        
        // 只有任务还在处理中才启动轮询
        if (shouldStartPolling) {
          // 每1秒检查一次更新
          intervalId = setInterval(checkUpdates, 1000);
        }

      } catch (error) {
        console.error('[SSE] 流初始化失败:', error);
        try {
          controller.close();
        } catch (e) {
          console.error('[SSE] 关闭流失败:', e);
        }
      }

      // 清理函数
      return () => {
        if (intervalId) {
          clearInterval(intervalId);
          intervalId = null;
        }
      };
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
