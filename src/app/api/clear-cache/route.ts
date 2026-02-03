import { NextRequest, NextResponse } from 'next/server';
import { clearCache, getCacheStats } from '@/lib/task-manager';

/**
 * 清空指定用户的缓存目录下的所有文件
 */
export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('user_id');
    
    if (!userId) {
      return NextResponse.json(
        { success: false, message: '缺少用户ID' },
        { status: 400 }
      );
    }
    
    // 获取清除前的缓存统计
    const beforeStats = getCacheStats(userId);
    
    // 清除指定用户的缓存
    clearCache(userId);
    
    // 获取清除后的缓存统计
    const afterStats = getCacheStats(userId);
    
    const deletedCount = beforeStats.count - afterStats.count;
    const freedSpace = beforeStats.totalSize - afterStats.totalSize;

    return NextResponse.json({
      success: true,
      message: `已清除 ${deletedCount} 个缓存文件，释放 ${formatBytes(freedSpace)} 空间`,
      deletedCount,
      freedSpace,
    });
  } catch (error) {
    console.error('清除缓存失败:', error);
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : '清除缓存失败',
      },
      { status: 500 }
    );
  }
}

/**
 * 格式化字节数
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}
