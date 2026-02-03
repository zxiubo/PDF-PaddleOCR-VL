import { NextRequest, NextResponse } from 'next/server';
import { getAllTasks } from '@/lib/task-manager';

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
    
    return NextResponse.json({
      success: true,
      tasks,
      count: tasks.length,
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
