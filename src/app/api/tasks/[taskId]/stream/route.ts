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
 * 创建 SSE 错误流
 */
function createErrorStream(message: string) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      const errorData = {
        type: 'error',
        error: message
      };
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorData)}\n\n`));
      controller.close();
    }
  });
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

  // 错误处理：始终返回 SSE 格式
  if (!userId) {
    return new Response(createErrorStream('缺少用户ID'), {
      status: 200, // SSE 不能返回 4xx，否则浏览器不会解析
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  }

  // 查询任务元数据
  const taskMetadata = await readTaskMetadata(taskId);

  if (!taskMetadata) {
    return new Response(createErrorStream('任务不存在'), {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  }

  // 验证用户权限
  if (taskMetadata.user_id !== userId) {
    return new Response(createErrorStream('无权访问该任务'), {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  }

  // 检查是否为后台任务
  if (!taskMetadata.is_background) {
    return new Response(createErrorStream('该任务不是后台任务，不支持SSE'), {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
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
      let isControllerClosed = false;
      let heartbeatId: NodeJS.Timeout | null = null;

      // 安全的 enqueue 函数
      const safeEnqueue = (data: string) => {
        if (!isControllerClosed) {
          try {
            controller.enqueue(encoder.encode(data));
          } catch (error) {
            if ((error as Error).message?.includes('Controller is already closed')) {
              isControllerClosed = true;
            }
          }
        }
      };

      try {
        // 发送心跳保持连接
        heartbeatId = setInterval(() => {
          if (!isControllerClosed) {
            safeEnqueue(':heartbeat\n\n');
          }
        }, 30000); // 每30秒发送一次心跳

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
            safeEnqueue(`data: ${JSON.stringify(status)}\n\n`);

            // 如果任务已经完成或失败，不启动轮询，直接关闭连接
            if (status.status === 'completed' || status.status === 'failed') {
              setTimeout(() => {
                if (!isControllerClosed) {
                  try {
                    isControllerClosed = true;
                    if (heartbeatId) clearInterval(heartbeatId);
                    if (intervalId) clearInterval(intervalId);
                    controller.close();
                  } catch (error) {
                    // 忽略关闭错误
                  }
                }
              }, 500);
              return false; // 不启动轮询
            }
            return true; // 启动轮询
          } catch (error) {
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
              safeEnqueue(`data: ${JSON.stringify(statusUpdate)}\n\n`);

              lastStatus = currentStatus;
              lastProgress = currentProgress;

              // 如果任务完成或失败，停止轮询
              if (currentStatus === 'completed' || currentStatus === 'failed') {
                if (intervalId) {
                  clearInterval(intervalId);
                  intervalId = null;
                }
                if (heartbeatId) {
                  clearInterval(heartbeatId);
                  heartbeatId = null;
                }

                // 发送最后的状态后关闭连接
                setTimeout(() => {
                  if (!isControllerClosed) {
                    try {
                      isControllerClosed = true;
                      controller.close();
                    } catch (error) {
                      // 忽略关闭错误
                    }
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
                    safeEnqueue(`data: ${JSON.stringify(logUpdate)}\n\n`);
                  });

                  lastLogSize = stats.size;
                }
              } catch (error) {
                // 忽略日志读取错误
              }
            }

          } catch (error) {
            // 忽略检查更新错误
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
        if (!isControllerClosed) {
          try {
            isControllerClosed = true;
            if (heartbeatId) clearInterval(heartbeatId);
            if (intervalId) clearInterval(intervalId);
            controller.close();
          } catch (e) {
            // 忽略关闭错误
          }
        }
      }

      // 清理函数
      return () => {
        if (heartbeatId) clearInterval(heartbeatId);
        if (intervalId) clearInterval(intervalId);
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
