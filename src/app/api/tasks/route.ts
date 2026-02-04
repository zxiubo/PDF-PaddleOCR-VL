import { NextRequest, NextResponse } from 'next/server';
import { getAllTasks, getTempBaseDir, getTasksBaseDir } from '@/lib/task-manager';
import fs from 'fs';
import path from 'path';

/**
 * GET - 获取所有任务列表
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('user_id');
    
    if (!userId) {
      return NextResponse.json(
        { success: false, message: '缺少用户ID' },
        { status: 400 }
      );
    }
    
    const tasks = getAllTasks(userId);
    
    // 调试信息：返回临时目录路径和目录存在状态
    const tempBaseDir = getTempBaseDir();
    const tasksBaseDir = getTasksBaseDir();
    const userTaskDir = path.join(tasksBaseDir, userId);
    
    let userDirExists = false;
    let userDirContents: string[] = [];
    
    try {
      if (fs.existsSync(userTaskDir)) {
        userDirExists = true;
        const entries = fs.readdirSync(userTaskDir, { withFileTypes: true });
        userDirContents = entries
          .filter(e => e.isDirectory())
          .map(e => e.name);
      }
    } catch (error) {
      console.error('[API] Error reading user directory:', error);
    }
    
    return NextResponse.json({
      success: true,
      tasks,
      count: tasks.length,
      debug: {
        tempBaseDir,
        tasksBaseDir,
        userTaskDir,
        userDirExists,
        userDirContents,
        env: {
          APP_TEMP_DIR: process.env.APP_TEMP_DIR || null,
          COZE_WORKSPACE_PATH: process.env.COZE_WORKSPACE_PATH || null,
          NODE_ENV: process.env.NODE_ENV || null,
        }
      }
    });
  } catch (error) {
    console.error('获取任务列表失败:', error);
    const message = error instanceof Error ? error.message : '获取任务列表失败';
    return NextResponse.json(
      { success: false, message },
      { status: 500 }
    );
  }
}
