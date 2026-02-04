'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  Clock, 
  FileText, 
  CheckCircle, 
  AlertCircle, 
  Trash2, 
  Download,
  RefreshCw,
  FolderOpen,
  X,
  ArrowRightToLine,
  CheckSquare,
  Square,
  XSquare,
  Trash,
  Eye,
  Loader2,
  TrendingUp
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { 
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { getCurrentUserId } from '@/lib/user-manager';

interface TaskMetadata {
  id: string;
  name: string;
  created_at: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  upload_files: {
    name: string;
    saved_name?: string;
    size: number;
    type: 'pdf' | 'template';
  }[];
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
  priority?: 'low' | 'normal' | 'high';
  started_at?: string;
  completed_at?: string;
  elapsed_time?: number;
  progress?: number;
  error?: string | null;
  is_background?: boolean;
}

// 调试信息接口
interface DebugInfo {
  tempBaseDir: string;
  tasksBaseDir: string;
  userTaskDir: string;
  userDirExists: boolean;
  userDirContents: string[];
  env: {
    APP_TEMP_DIR: string | null;
    COZE_WORKSPACE_PATH: string | null;
    NODE_ENV: string | null;
  };
}

export default function TasksPage() {
  const router = useRouter();
  const [tasks, setTasks] = useState<TaskMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingTask, setDeletingTask] = useState<string | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [clearingAll, setClearingAll] = useState(false);
  
  // 调试信息状态
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
  const [showDebugInfo, setShowDebugInfo] = useState(false);
   
  // 任务详情对话框状态
  const [showTaskDetail, setShowTaskDetail] = useState(false);
  const [selectedTask, setSelectedTask] = useState<TaskMetadata | null>(null);
  const [taskLogs, setTaskLogs] = useState<string[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [streamLogs, setStreamLogs] = useState<string[]>([]);

  // JSON预览对话框状态
  const [showJsonPreview, setShowJsonPreview] = useState(false);
  const [jsonPreviewContent, setJsonPreviewContent] = useState<any>(null);
  const [loadingJsonPreview, setLoadingJsonPreview] = useState(false);

  // 加载JSON预览内容
  const handleLoadJsonPreview = async (taskId: string, jsonFilename: string) => {
    setLoadingJsonPreview(true);
    setJsonPreviewContent(null);
    
    try {
      const apiUrl = new URL('/api/download', window.location.origin);
      apiUrl.searchParams.append('file_type', 'json');
      apiUrl.searchParams.append('filename', jsonFilename);
      apiUrl.searchParams.append('task_id', taskId);
      
      const response = await fetch(apiUrl.toString());
      if (!response.ok) {
        throw new Error('加载失败');
      }

      const text = await response.text();
      const jsonData = JSON.parse(text);
      setJsonPreviewContent(jsonData);
      setShowJsonPreview(true);
    } catch (error) {
      console.error('加载JSON预览失败:', error);
      alert('加载JSON预览失败，请重试');
    } finally {
      setLoadingJsonPreview(false);
    }
  };

  const fetchTasks = async () => {
    setLoading(true);
    try {
      const userId = getCurrentUserId();
      const response = await fetch(`/api/tasks?user_id=${userId}`);
      const data = await response.json();
      if (data.success) {
        setTasks(data.tasks);
        // 保存调试信息
        if (data.debug) {
          setDebugInfo(data.debug);
        }
      }
    } catch (error) {
      console.error('获取任务列表失败:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
  }, []);

  // 注释掉自动刷新逻辑，避免频繁请求
  // // 处理中任务自动刷新
  // useEffect(() => {
  //   const processingTasks = tasks.filter(t => t.status === 'processing');
  //   if (processingTasks.length > 0) {
  //     const timer = setInterval(fetchTasks, 5000); // 每5秒刷新一次
  //     return () => clearInterval(timer);
  //   }
  // }, [tasks]);

  // 监听实时日志流（仅后台任务）
  useEffect(() => {
    // 只有后台任务且正在处理时才建立SSE连接
    if (!showTaskDetail || !selectedTask || !selectedTask.is_background || selectedTask.status !== 'processing') {
      return;
    }

    const userId = getCurrentUserId();
    const taskId = selectedTask.id;
    let retryCount = 0;
    const MAX_RETRIES = 3;
    let eventSource: EventSource | null = null;
    let isManuallyClosed = false;
    let retryTimeoutId: NodeJS.Timeout | null = null;

    const connect = () => {
      if (retryCount >= MAX_RETRIES) {
        console.error('[SSE] 重连次数超过限制，停止重试');
        return;
      }

      retryCount++;

      eventSource = new EventSource(`/api/tasks/${taskId}/stream?user_id=${userId}`);

      eventSource.onopen = () => {
        // 连接成功，重置重试计数
        retryCount = 0;
      };

      eventSource.onmessage = (event) => {
        // 忽略心跳消息
        if (event.data.startsWith(':heartbeat')) {
          return;
        }

        try {
          const data = JSON.parse(event.data);

          if (data.type === 'log') {
            setStreamLogs(prev => [...prev, data.message]);
          } else if (data.type === 'progress') {
            setSelectedTask(prev => prev ? {
              ...prev,
              progress: data.progress,
              elapsed_time: data.elapsed_time
            } : null);
          } else if (data.type === 'status') {
            setSelectedTask(prev => prev ? {
              ...prev,
              status: data.status,
              completed_at: data.completed_at,
              elapsed_time: data.elapsed_time,
              progress: data.progress ?? 100
            } : null);
            // 任务完成后关闭SSE连接
            if (data.status === 'completed' || data.status === 'failed') {
              isManuallyClosed = true;
              eventSource?.close();
            }
          } else if (data.type === 'error') {
            // 服务端返回错误，显示错误但不重试
            setSelectedTask(prev => prev ? {
              ...prev,
              status: 'failed',
              error: data.error
            } : null);
            isManuallyClosed = true;
            eventSource?.close();
          }
        } catch (parseError) {
          console.error('[SSE] 解析消息失败:', parseError);
        }
      };

      eventSource.onerror = () => {
        // 如果手动关闭，不重试
        if (isManuallyClosed) {
          return;
        }

        // 只有在连接真正关闭时才重试
        if (eventSource?.readyState === EventSource.CLOSED) {
          // 固定3秒重连间隔
          const delay = 3000;

          if (retryTimeoutId) {
            clearTimeout(retryTimeoutId);
          }

          retryTimeoutId = setTimeout(() => {
            if (!isManuallyClosed && retryCount < MAX_RETRIES) {
              connect();
            }
          }, delay);
        }
        // CONNECTING 状态让浏览器自动处理，OPEN 状态忽略错误
      };
    };

    // 首次连接
    connect();

    return () => {
      isManuallyClosed = true;
      if (retryTimeoutId) {
        clearTimeout(retryTimeoutId);
      }
      eventSource?.close();
    };
    // 使用具体值作为依赖，避免对象引用变化导致重复执行
  }, [showTaskDetail, selectedTask?.id, selectedTask?.is_background, selectedTask?.status]);

  const handleDeleteTask = async (taskId: string) => {
    setDeletingTask(taskId);
    try {
      const userId = getCurrentUserId();
      const response = await fetch(`/api/tasks/${taskId}?user_id=${userId}`, {
        method: 'DELETE',
      });
      const data = await response.json();
      
      if (data.success) {
        setTasks(tasks.filter(t => t.id !== taskId));
        setSelectedTaskIds(prev => {
          const newSet = new Set(prev);
          newSet.delete(taskId);
          return newSet;
        });
      } else {
        alert(data.message);
      }
    } catch (error) {
      console.error('删除任务失败:', error);
      alert('删除任务失败');
    } finally {
      setDeletingTask(null);
    }
  };

  // 处理单个任务的选择
  const handleSelectTask = (taskId: string, checked: boolean) => {
    setSelectedTaskIds(prev => {
      const newSet = new Set(prev);
      if (checked) {
        newSet.add(taskId);
      } else {
        newSet.delete(taskId);
      }
      return newSet;
    });
  };

  // 处理全选/取消全选
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedTaskIds(new Set(tasks.map(t => t.id)));
    } else {
      setSelectedTaskIds(new Set());
    }
  };

  // 批量删除选中的任务
  const handleBatchDelete = async () => {
    if (selectedTaskIds.size === 0) return;

    setBatchDeleting(true);
    try {
      const userId = getCurrentUserId();
      const deletePromises = Array.from(selectedTaskIds).map(taskId =>
        fetch(`/api/tasks/${taskId}?user_id=${userId}`, { method: 'DELETE' })
      );

      const results = await Promise.all(deletePromises);
      
      let successCount = 0;
      let failCount = 0;

      results.forEach(response => {
        if (response.ok) successCount++;
        else failCount++;
      });

      if (successCount > 0) {
        setTasks(tasks.filter(t => !selectedTaskIds.has(t.id)));
        setSelectedTaskIds(new Set());
      }

      if (failCount > 0) {
        alert(`删除完成：成功 ${successCount} 个，失败 ${failCount} 个`);
      }
    } catch (error) {
      console.error('批量删除失败:', error);
      alert('批量删除失败');
    } finally {
      setBatchDeleting(false);
    }
  };

  // 清空所有任务
  const handleClearAll = async () => {
    if (tasks.length === 0) return;

    setClearingAll(true);
    try {
      const userId = getCurrentUserId();
      const deletePromises = tasks.map(task =>
        fetch(`/api/tasks/${task.id}?user_id=${userId}`, { method: 'DELETE' })
      );

      const results = await Promise.all(deletePromises);
      
      let successCount = 0;
      let failCount = 0;

      results.forEach(response => {
        if (response.ok) successCount++;
        else failCount++;
      });

      if (successCount > 0) {
        setTasks([]);
        setSelectedTaskIds(new Set());
      }

      if (failCount > 0) {
        alert(`清空完成：成功 ${successCount} 个，失败 ${failCount} 个`);
      }
    } catch (error) {
      console.error('清空任务失败:', error);
      alert('清空任务失败');
    } finally {
      setClearingAll(false);
    }
  };

  const handleDownload = async (taskId: string, fileType: 'excel' | 'json', filename: string) => {
    try {
      const apiUrl = new URL('/api/download', window.location.origin);
      apiUrl.searchParams.append('file_type', fileType);
      apiUrl.searchParams.append('filename', filename);
      apiUrl.searchParams.append('task_id', taskId);
      
      const response = await fetch(apiUrl.toString());
      if (!response.ok) {
        throw new Error('下载失败');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('下载失败:', error);
      alert('下载失败，请重试');
    }
  };

  const handleUploadFileDownload = async (taskId: string, file: { name: string; saved_name?: string; type: 'pdf' | 'template' }) => {
    if (!file.saved_name) {
      alert('文件不存在');
      return;
    }
    
    try {
      const fileType = file.type === 'pdf' ? 'pdf' : 'template';
      const apiUrl = new URL('/api/download', window.location.origin);
      apiUrl.searchParams.append('file_type', fileType);
      apiUrl.searchParams.append('filename', file.saved_name);
      apiUrl.searchParams.append('task_id', taskId);
      apiUrl.searchParams.append('upload', 'true');
      
      const response = await fetch(apiUrl.toString());
      if (!response.ok) {
        throw new Error('下载失败');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('下载失败:', error);
      alert('下载失败，请重试');
    }
  };

  // 查看任务详情
  const handleViewTaskDetail = async (task: TaskMetadata) => {
    setSelectedTask(task);
    setShowTaskDetail(true);
    setTaskLogs([]);
    setLoadingLogs(true);
    
    try {
      const userId = getCurrentUserId();
      const response = await fetch(`/api/tasks/${task.id}/logs?user_id=${userId}`);
      const data = await response.json();
      
      if (data.success) {
        setTaskLogs(data.logs || []);
      }
    } catch (error) {
      console.error('获取任务日志失败:', error);
    } finally {
      setLoadingLogs(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatElapsedTime = (ms?: number) => {
    if (!ms) return '-';
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}小时${minutes % 60}分钟`;
    } else if (minutes > 0) {
      return `${minutes}分钟${seconds % 60}秒`;
    } else {
      return `${seconds}秒`;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge variant="default" className="bg-green-500">已完成</Badge>;
      case 'processing':
        return <Badge variant="secondary" className="bg-blue-500">处理中</Badge>;
      case 'failed':
        return <Badge variant="destructive">失败</Badge>;
      default:
        return <Badge variant="secondary">等待中</Badge>;
    }
  };

  const getPriorityBadge = (priority?: string) => {
    switch (priority) {
      case 'high':
        return <Badge variant="default" className="bg-red-500">高</Badge>;
      case 'low':
        return <Badge variant="secondary" className="bg-slate-500">低</Badge>;
      default:
        return <Badge variant="secondary" className="bg-blue-600">普通</Badge>;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* 页面头部 */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold text-slate-900 dark:text-slate-100 mb-2">
              任务管理
            </h1>
            <p className="text-slate-600 dark:text-slate-400">
              查看和管理所有提取任务
            </p>
          </div>
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => router.push('/')}
              className="flex items-center gap-2"
            >
              <FileText className="w-4 h-4" />
              新建任务
            </Button>
            <Button
              variant="outline"
              onClick={fetchTasks}
              disabled={loading}
              className="flex items-center gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              刷新
            </Button>
          </div>
        </div>

        {/* 任务列表 */}
        {loading ? (
          <div className="text-center py-12">
            <RefreshCw className="w-8 h-8 mx-auto mb-4 text-slate-400 animate-spin" />
            <p className="text-slate-600 dark:text-slate-400">加载任务列表...</p>
          </div>
        ) : tasks.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <FolderOpen className="w-16 h-16 mx-auto mb-4 text-slate-300" />
              <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">
                暂无任务
              </h3>
              <p className="text-slate-600 dark:text-slate-400 mb-6">
                还没有创建任何提取任务
              </p>
              <div className="flex flex-col items-center gap-3">
                <Button onClick={() => router.push('/')}>
                  <FileText className="w-4 h-4 mr-2" />
                  创建第一个任务
                </Button>
                
                {/* 调试信息按钮 */}
                {debugInfo && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowDebugInfo(!showDebugInfo)}
                    className="text-slate-500"
                  >
                    {showDebugInfo ? '隐藏调试信息' : '显示调试信息'}
                  </Button>
                )}
              </div>
              
              {/* 调试信息面板 */}
              {showDebugInfo && debugInfo && (
                <div className="mt-6 p-4 bg-slate-100 dark:bg-slate-800 rounded-lg text-left">
                  <h4 className="text-sm font-semibold mb-3 text-slate-700 dark:text-slate-300">
                    调试信息（帮助排查任务丢失问题）
                  </h4>
                  <div className="space-y-2 text-xs font-mono text-slate-600 dark:text-slate-400">
                    <div className="grid grid-cols-[120px_1fr] gap-2">
                      <span className="text-slate-500">临时目录:</span>
                      <span className="break-all">{debugInfo.tempBaseDir}</span>
                    </div>
                    <div className="grid grid-cols-[120px_1fr] gap-2">
                      <span className="text-slate-500">任务目录:</span>
                      <span className="break-all">{debugInfo.tasksBaseDir}</span>
                    </div>
                    <div className="grid grid-cols-[120px_1fr] gap-2">
                      <span className="text-slate-500">用户目录:</span>
                      <span className="break-all">{debugInfo.userTaskDir}</span>
                    </div>
                    <div className="grid grid-cols-[120px_1fr] gap-2">
                      <span className="text-slate-500">目录存在:</span>
                      <span className={debugInfo.userDirExists ? 'text-green-600' : 'text-red-600'}>
                        {debugInfo.userDirExists ? '是' : '否'}
                      </span>
                    </div>
                    {debugInfo.userDirExists && (
                      <div className="grid grid-cols-[120px_1fr] gap-2">
                        <span className="text-slate-500">目录内容:</span>
                        <span>{debugInfo.userDirContents.length > 0 ? `${debugInfo.userDirContents.length} 个任务` : '空'}</span>
                      </div>
                    )}
                    <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
                      <div className="text-slate-500 mb-1">环境变量:</div>
                      <div className="pl-2 space-y-1">
                        <div>APP_TEMP_DIR: {debugInfo.env.APP_TEMP_DIR || '未设置'}</div>
                        <div>COZE_WORKSPACE_PATH: {debugInfo.env.COZE_WORKSPACE_PATH || '未设置'}</div>
                        <div>NODE_ENV: {debugInfo.env.NODE_ENV || '未设置'}</div>
                      </div>
                    </div>
                    {!debugInfo.userDirExists && (
                      <div className="mt-3 p-2 bg-yellow-50 dark:bg-yellow-900/20 rounded text-yellow-700 dark:text-yellow-400">
                        <strong>可能的原因:</strong><br />
                        1. 临时目录配置不一致（检查 APP_TEMP_DIR 环境变量）<br />
                        2. 服务器重启导致 /tmp 目录被清空<br />
                        3. 用户ID发生变化（浏览器 localStorage 被清除）<br />
                        4. 部署环境使用了不同的临时目录
                      </div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          <>
            {/* 批量操作栏 */}
            {tasks.length > 0 && (
              <div className="flex items-center justify-between mb-4 p-4 bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={selectedTaskIds.size === tasks.length && tasks.length > 0}
                      onCheckedChange={handleSelectAll}
                      className="w-5 h-5"
                    />
                    <span className="text-sm text-slate-700 dark:text-slate-300">
                      {selectedTaskIds.size > 0 
                        ? `已选择 ${selectedTaskIds.size} 个任务`
                        : '全选'
                      }
                    </span>
                  </div>
                  {selectedTaskIds.size > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleSelectAll(false)}
                      className="text-xs"
                    >
                      取消全选
                    </Button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {/* 批量删除 */}
                  {selectedTaskIds.size > 0 && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={batchDeleting}
                          className="flex items-center gap-2"
                        >
                          {batchDeleting ? (
                            <RefreshCw className="w-4 h-4 animate-spin" />
                          ) : (
                            <Trash className="w-4 h-4" />
                          )}
                          删除选中 ({selectedTaskIds.size})
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>确认批量删除</AlertDialogTitle>
                          <AlertDialogDescription>
                            确定要删除选中的 {selectedTaskIds.size} 个任务吗？此操作无法撤销。
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel disabled={batchDeleting}>取消</AlertDialogCancel>
                          <AlertDialogAction onClick={handleBatchDelete} disabled={batchDeleting}>
                            确认删除
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                  
                  {/* 清空所有任务 */}
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={clearingAll || tasks.length === 0}
                        className="flex items-center gap-2"
                      >
                        {clearingAll ? (
                          <RefreshCw className="w-4 h-4 animate-spin" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                        清空所有任务
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>确认清空所有任务</AlertDialogTitle>
                        <AlertDialogDescription>
                          确定要清空所有 {tasks.length} 个任务吗？此操作无法撤销。
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel disabled={clearingAll}>取消</AlertDialogCancel>
                        <AlertDialogAction onClick={handleClearAll} disabled={clearingAll}>
                          确认清空
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            )}
            
            {/* 任务卡片列表 */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {tasks.map((task) => (
              <Card key={task.id} className="hover:shadow-lg transition-shadow flex flex-col h-full">
                <CardHeader>
                  <div className="flex items-start gap-3">
                    {/* 任务复选框 */}
                    <div className="pt-1">
                      <Checkbox
                        checked={selectedTaskIds.has(task.id)}
                        onCheckedChange={(checked) => handleSelectTask(task.id, !!checked)}
                        className="w-5 h-5"
                      />
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <CardTitle className="text-lg truncate mb-2">
                            Task-{task.id.slice(-8)}
                          </CardTitle>
                          <CardDescription className="flex items-center gap-2">
                            <Clock className="w-3 h-3" />
                            {formatDate(task.created_at)}
                          </CardDescription>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <div className="flex items-center gap-1">
                            {getPriorityBadge(task.priority)}
                            {getStatusBadge(task.status)}
                          </div>
                          {task.is_background && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => handleViewTaskDetail(task)}
                            >
                              <Eye className="w-3 h-3 mr-1" />
                              查看详情
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 overflow-auto space-y-4">
                  {/* 上传文件 */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                        上传文件
                      </p>
                      <span className="text-xs text-slate-500">
                        {task.upload_files.length} 个文件
                      </span>
                    </div>
                    <div className="space-y-1 h-40 overflow-hidden">
                      {task.upload_files.slice(0, 3).map((file, idx) => (
                        <div key={idx} className="flex items-center justify-between text-sm p-2 bg-slate-50 dark:bg-slate-800 rounded">
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <FileText className={`w-3 h-3 ${file.type === 'pdf' ? 'text-red-500' : 'text-green-500'} flex-shrink-0`} />
                            <span className="truncate" title={file.name}>{file.name}</span>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className="text-xs text-slate-500">
                              {formatFileSize(file.size)}
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                              onClick={() => handleUploadFileDownload(task.id, file)}
                              title={`下载 ${file.name}`}
                            >
                              <Download className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>
                      ))}
                      {task.upload_files.length >= 4 && (
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              className="w-full"
                            >
                              查看全部 {task.upload_files.length} 个文件
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-2xl max-h-[80vh]">
                            <DialogHeader>
                              <DialogTitle>上传文件列表</DialogTitle>
                              <DialogDescription>
                                任务 {task.name} 共上传 {task.upload_files.length} 个文件
                              </DialogDescription>
                            </DialogHeader>
                            <div className="max-h-[60vh] overflow-y-auto space-y-2 mt-4">
                              {task.upload_files.map((file, idx) => (
                                <div
                                  key={idx}
                                  className="flex items-center justify-between text-sm p-3 bg-slate-50 dark:bg-slate-800 rounded hover:bg-slate-100 dark:hover:bg-slate-750 transition-colors"
                                >
                                  <div className="flex items-center gap-2 flex-1 min-w-0">
                                    <span className="text-xs text-slate-500 w-6 flex-shrink-0">{idx + 1}.</span>
                                    <FileText className={`w-4 h-4 ${file.type === 'pdf' ? 'text-red-500' : 'text-green-500'} flex-shrink-0`} />
                                    <span className="truncate" title={file.name}>{file.name}</span>
                                    <span className="text-xs text-slate-500 flex-shrink-0 ml-2">
                                      {formatFileSize(file.size)}
                                    </span>
                                  </div>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 w-8 p-0 flex-shrink-0"
                                    onClick={() => handleUploadFileDownload(task.id, file)}
                                    title={`下载 ${file.name}`}
                                  >
                                    <Download className="w-4 h-4" />
                                  </Button>
                                </div>
                              ))}
                            </div>
                          </DialogContent>
                        </Dialog>
                      )}
                    </div>
                  </div>

                  {/* 处理进度（后台任务） */}
                  {task.is_background && task.status === 'processing' && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                          处理进度
                        </p>
                        <span className="text-xs text-slate-500">
                          {task.progress || 0}%
                        </span>
                      </div>
                      <Progress value={task.progress || 0} className="h-2" />
                    </div>
                  )}

                  {/* 执行时间（后台任务） */}
                  {task.is_background && (task.started_at || task.elapsed_time) && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-600 dark:text-slate-400">执行时间</span>
                      <span className="text-slate-900 dark:text-slate-100">
                        {formatElapsedTime(task.elapsed_time)}
                      </span>
                    </div>
                  )}

                  {/* 处理结果 */}
                  {task.status === 'completed' && task.result_files && (
                    <div>
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                        处理结果
                      </p>
                      <div className="space-y-2">
                        {task.result_files.excel && (
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              className="flex-1 justify-start h-auto py-2 px-2 min-w-[100px]"
                              onClick={() => handleDownload(task.id, 'excel', task.result_files!.excel)}
                              title={task.result_files.excel}
                            >
                              <Download className="w-3 h-3 mr-2 flex-shrink-0" />
                              <span className="truncate text-left">
                                下载Excel
                              </span>
                            </Button>
                            {task.result_files.json && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="flex-1 justify-start h-auto py-2 px-2 min-w-[100px]"
                                onClick={() => handleLoadJsonPreview(task.id, task.result_files!.json)}
                                disabled={loadingJsonPreview}
                                title="预览JSON内容"
                              >
                                {loadingJsonPreview ? (
                                  <Loader2 className="w-3 h-3 mr-2 flex-shrink-0 animate-spin" />
                                ) : (
                                  <Eye className="w-3 h-3 mr-2 flex-shrink-0" />
                                )}
                                <span className="truncate text-left">
                                  预览JSON
                                </span>
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* 校验统计 */}
                  {task.status === 'completed' && task.validation_summary && (
                    <div className="grid grid-cols-3 gap-2 pt-2 border-t">
                      <div className="text-center">
                        <div className="text-lg font-bold text-green-600 dark:text-green-400">
                          {task.validation_summary.ok}
                        </div>
                        <div className="text-xs text-slate-600 dark:text-slate-400">正常</div>
                      </div>
                      <div className="text-center">
                        <div className="text-lg font-bold text-yellow-600 dark:text-yellow-400">
                          {task.validation_summary.warning}
                        </div>
                        <div className="text-xs text-slate-600 dark:text-slate-400">存疑</div>
                      </div>
                      <div className="text-center">
                        <div className="text-lg font-bold text-red-600 dark:text-red-400">
                          {task.validation_summary.error}
                        </div>
                        <div className="text-xs text-slate-600 dark:text-slate-400">错误</div>
                      </div>
                    </div>
                  )}

                  {/* 错误信息 */}
                  {task.status === 'failed' && task.message && (
                    <div className="p-3 bg-red-50 dark:bg-red-950 rounded-lg">
                      <p className="text-sm text-red-600 dark:text-red-400">
                        {task.message}
                      </p>
                    </div>
                  )}
                </CardContent>

                {/* 操作按钮 */}
                <div className="p-6 pt-4 border-t flex gap-2">
                    {/* 继续上传按钮 */}
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 py-[10px] px-[10px]"
                      onClick={() => router.push(`/?task_id=${task.id}`)}
                    >
                      <ArrowRightToLine className="w-4 h-4 mr-2" />
                      继续上传
                    </Button>

                    {/* 删除按钮 */}
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="destructive"
                          size="sm"
                          className="flex-1 py-[10px] px-[10px]"
                          disabled={deletingTask === task.id}
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          {deletingTask === task.id ? '删除中...' : '删除任务'}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>确认删除任务</AlertDialogTitle>
                          <AlertDialogDescription>
                            删除任务将同时删除所有上传的文件和解析结果，此操作不可恢复。确定要删除吗？
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>取消</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleDeleteTask(task.id)}
                            className="bg-red-600 hover:bg-red-700"
                          >
                            确认删除
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
              </Card>
            ))}
            </div>
          </>
        )}
      </div>
      
      {/* 任务详情对话框 */}
      <Dialog open={showTaskDetail} onOpenChange={setShowTaskDetail}>
        <DialogContent 
          className="sm:!max-w-5xl max-h-[90vh] overflow-hidden flex flex-col"
          style={{ maxWidth: '50vw' }}
        >
          <DialogHeader className="pb-4">
            <DialogTitle className="flex items-center gap-3">
              <span>任务详情</span>
              {selectedTask?.is_background && (
                <Badge variant="outline" className="bg-slate-100 dark:bg-slate-800">
                  后台任务
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              {selectedTask?.name} ({selectedTask?.id})
            </DialogDescription>
          </DialogHeader>
          
          <div className="flex-1 flex flex-col min-h-0">
            {/* 任务状态信息 */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 mb-4 flex-shrink-0">
              <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
                <div className="text-xs text-slate-600 dark:text-slate-400 mb-1">状态</div>
                <div className="flex items-center gap-2">
                  {selectedTask?.status === 'processing' && (
                    <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                  )}
                  {getStatusBadge(selectedTask?.status || 'pending')}
                </div>
              </div>
              
              <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
                <div className="text-xs text-slate-600 dark:text-slate-400 mb-1">优先级</div>
                <div>
                  {getPriorityBadge(selectedTask?.priority)}
                </div>
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
                <div className="text-xs text-slate-600 dark:text-slate-400 mb-1">文件数量</div>
                <div className="font-semibold text-slate-900 dark:text-slate-100">
                  {selectedTask?.upload_files.length || 0}
                </div>
              </div>
              
              {selectedTask?.is_background && (
                <>
                  <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
                    <div className="text-xs text-slate-600 dark:text-slate-400 mb-1">进度</div>
                    <div className="font-semibold text-slate-900 dark:text-slate-100">
                      {selectedTask?.progress || 0}%
                    </div>
                  </div>
                  
                  <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
                    <div className="text-xs text-slate-600 dark:text-slate-400 mb-1">执行时间</div>
                    <div className="font-semibold text-slate-900 dark:text-slate-100">
                      {formatElapsedTime(selectedTask?.elapsed_time)}
                    </div>
                  </div>

                  <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
                    <div className="text-xs text-slate-600 dark:text-slate-400 mb-1">创建时间</div>
                    <div className="font-semibold text-slate-900 dark:text-slate-100 text-xs">
                      {formatDate(selectedTask?.created_at || '')}
                    </div>
                  </div>
                </>
              )}

              {!selectedTask?.is_background && (
                <>
                  <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
                    <div className="text-xs text-slate-600 dark:text-slate-400 mb-1">创建时间</div>
                    <div className="font-semibold text-slate-900 dark:text-slate-100 text-xs">
                      {formatDate(selectedTask?.created_at || '')}
                    </div>
                  </div>

                  {selectedTask?.validation_summary && (
                    <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
                      <div className="text-xs text-slate-600 dark:text-slate-400 mb-1">校验结果</div>
                      <div className="font-semibold text-slate-900 dark:text-slate-100 text-xs">
                        ✓ {selectedTask.validation_summary.ok} | 
                        ⚠ {selectedTask.validation_summary.warning} | 
                        ✗ {selectedTask.validation_summary.error}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
            
            {/* 进度条 */}
            {selectedTask?.is_background && selectedTask.status === 'processing' && (
              <div className="mb-4 flex-shrink-0">
                <Progress value={selectedTask.progress || 0} className="h-3" />
              </div>
            )}
            
            {/* 日志区域 */}
            <div className="flex-1 bg-slate-900 dark:bg-slate-950 rounded-lg p-4 overflow-hidden flex flex-col">
              <div className="flex items-center justify-between mb-2 flex-shrink-0">
                <span className="text-sm font-medium text-slate-300">
                  处理日志
                </span>
                <div className="flex items-center gap-2">
                  {selectedTask?.status === 'processing' && (
                    <Badge variant="outline" className="bg-blue-500/10 text-blue-400 border-blue-500/20">
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                      实时更新中
                    </Badge>
                  )}
                  <span className="text-xs text-slate-500">
                    共 {taskLogs.length + streamLogs.length} 条日志
                  </span>
                </div>
              </div>
              
              <div className="flex-1 overflow-y-auto font-mono text-xs space-y-1">
                {loadingLogs ? (
                  <div className="flex items-center justify-center h-20 text-slate-500">
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    加载日志中...
                  </div>
                ) : taskLogs.length === 0 && streamLogs.length === 0 ? (
                  <div className="text-center text-slate-500 py-8">
                    暂无日志
                  </div>
                ) : (
                  <>
                    {taskLogs.map((log, idx) => (
                      <div
                        key={`old-${idx}`}
                        className="text-slate-300 hover:bg-slate-800/50 px-2 py-1 rounded"
                      >
                        {log}
                      </div>
                    ))}
                    {streamLogs.map((log, idx) => (
                      <div
                        key={`stream-${idx}`}
                        className="text-green-400 hover:bg-slate-800/50 px-2 py-1 rounded bg-green-500/5"
                      >
                        {log}
                      </div>
                    ))}
                  </>
                )}
                
                {/* 自动滚动到底部 */}
                <div ref={(el) => {
                  if (el) {
                    el.scrollIntoView({ behavior: 'smooth' });
                  }
                }} />
              </div>
            </div>
          </div>
          
          <DialogFooter className="pt-4">
            <Button
              variant="outline"
              onClick={() => setShowTaskDetail(false)}
            >
              关闭
            </Button>
            {selectedTask?.status === 'completed' && selectedTask.result_files?.excel && (
              <Button
                onClick={() => {
                  handleDownload(selectedTask.id, 'excel', selectedTask.result_files!.excel);
                }}
              >
                <Download className="w-4 h-4 mr-2" />
                下载结果
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* JSON预览对话框 */}
      <Dialog open={showJsonPreview} onOpenChange={setShowJsonPreview}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader className="pb-4">
            <DialogTitle>JSON数据预览</DialogTitle>
            <DialogDescription>
              查看提取的招聘信息数据
            </DialogDescription>
          </DialogHeader>
          
          <div className="flex-1 overflow-hidden flex flex-col min-h-0">
            {loadingJsonPreview ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
              </div>
            ) : jsonPreviewContent ? (
              <div className="flex-1 overflow-auto">
                <pre className="bg-slate-900 dark:bg-slate-950 text-slate-100 dark:text-slate-100 p-4 rounded-lg text-xs font-mono whitespace-pre-wrap">
                  {JSON.stringify(jsonPreviewContent, null, 2)}
                </pre>
              </div>
            ) : null}
          </div>
          
          <DialogFooter className="pt-4">
            <Button
              variant="outline"
              onClick={() => setShowJsonPreview(false)}
            >
              关闭
            </Button>
            <Button
              onClick={() => {
                if (selectedTask?.result_files?.json) {
                  handleDownload(selectedTask.id, 'json', selectedTask.result_files!.json);
                }
              }}
            >
              <Download className="w-4 h-4 mr-2" />
              下载JSON
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
