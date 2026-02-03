'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, FileText, CheckCircle, AlertCircle, Download, X, Loader2, FolderOpen, Plus, ArrowRightToLine, Trash2, RefreshCw, Key, Lock, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
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
import { getCurrentUserId, getUserToken, setUserToken, hasUserToken, getUserApiUrl, setUserApiUrl, hasUserApiUrl } from '@/lib/user-manager';

interface UploadedFile {
  id: string;
  name: string;
  size: number;
  file?: File;  // 可选：已提交的文件不需要File对象
  submittedAt?: string;  // 提交时间
}

interface ProcessingResult {
  success: boolean;
  message: string;
  task_id?: string;
  excel_file?: string;
  json_file?: string;
  records_count?: number;
  validation_summary?: {
    ok: number;
    warning: number;
    error: number;
  };
}

export default function RecruitmentInfoExtractor() {
  const router = useRouter();
  const [pdfFiles, setPdfFiles] = useState<UploadedFile[]>([]);  // 待提交的文件
  const [submittedFiles, setSubmittedFiles] = useState<UploadedFile[]>([]);  // 已提交的文件
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [useDefaultTemplate, setUseDefaultTemplate] = useState(true);
  const [existingTemplateName, setExistingTemplateName] = useState<string | null>(null);  // 继续上传时已使用的模板名称
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ProcessingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [isContinueUpload, setIsContinueUpload] = useState(false);
  const [clearingCache, setClearingCache] = useState(false);
  
  // Token和API URL相关状态
  const [showSettings, setShowSettings] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [apiUrlInput, setApiUrlInput] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [userToken, setUserTokenState] = useState<string | null>(null);
  const [userApiUrl, setUserApiUrlState] = useState<string | null>(null);
  
  // 进度日志状态
  const [progressLogs, setProgressLogs] = useState<{ 
    message: string; 
    time: string; 
    fileName?: string; 
    elapsedTime?: number; 
  }[]>([]);
  
  // JSON 预览相关状态
  const [showJsonPreview, setShowJsonPreview] = useState(false);
  const [jsonPreviewContent, setJsonPreviewContent] = useState<any>(null);
  const [jsonPreviewLoading, setJsonPreviewLoading] = useState(false);
  
  // 优先级选择状态
  const [taskPriority, setTaskPriority] = useState<'high' | 'normal' | 'low'>('normal');

  const pdfInputRef = useRef<HTMLInputElement>(null);
  const templateInputRef = useRef<HTMLInputElement>(null);

  // 从URL参数中获取task_id
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const taskId = urlParams.get('task_id');
    if (taskId) {
      setCurrentTaskId(taskId);
      setIsContinueUpload(true);
      
      // 获取任务详情以恢复模板信息
      const userId = getCurrentUserId();
      fetch(`/api/tasks/${taskId}?user_id=${encodeURIComponent(userId)}`)
        .then(res => res.json())
        .then(data => {
          if (data.success && data.task?.upload_files) {
            // 查找自定义模板文件
            const templateFile = data.task.upload_files.find(
              (file: any) => file.type === 'template'
            );
            
            if (templateFile) {
              setUseDefaultTemplate(false);
              setExistingTemplateName(templateFile.name);
              console.log('任务使用的自定义模板:', templateFile.name);
            }
          }
        })
        .catch(err => {
          console.error('获取任务详情失败:', err);
        });
    }
  }, []);

  // 加载用户Token和API URL
  useEffect(() => {
    const token = getUserToken();
    setUserTokenState(token);
    
    const apiUrl = getUserApiUrl();
    setUserApiUrlState(apiUrl);
  }, []);

  // 处理中时禁止页面刷新
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      // 只在处理中时才显示确认对话框，防止用户意外关闭页面
      if (processing) {
        const message = '任务正在处理中，确定要离开吗？';
        e.preventDefault();
        e.returnValue = message; // Chrome 需要设置 returnValue
        return message;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [processing]);

  const handleNewTask = () => {
    // 清空当前状态
    setPdfFiles([]);
    setSubmittedFiles([]);
    setTemplateFile(null);
    setUseDefaultTemplate(true);
    setExistingTemplateName(null);  // 清空已使用的模板名称
    setProgress(0);
    setResult(null);
    setError(null);
    setCurrentTaskId(null);
    setIsContinueUpload(false);
    
    // 清空文件输入
    if (pdfInputRef.current) {
      pdfInputRef.current.value = '';
    }
    if (templateInputRef.current) {
      templateInputRef.current.value = '';
    }
  };

  const handleClearFiles = () => {
    setPdfFiles([]);  // 只清空待提交的文件
    // 清空文件输入，允许重新选择
    if (pdfInputRef.current) {
      pdfInputRef.current.value = '';
    }
  };

  const handleContinueUpload = () => {
    setIsContinueUpload(true);
    // 不清空文件列表，让用户可以看到已提交的文件并继续添加
    // 用户可以点击"新建任务"来清空所有内容
    setProgress(0);
    setResult(null);
    setError(null);
  };

  const handleClearCache = async () => {
    setClearingCache(true);
    try {
      const userId = getCurrentUserId();
      const response = await fetch(`/api/clear-cache?user_id=${userId}`, {
        method: 'POST',
      });
      const data = await response.json();
      
      if (data.success) {
        alert(data.message);
      } else {
        alert(`清除缓存失败: ${data.message}`);
      }
    } catch (error) {
      console.error('清除缓存失败:', error);
      alert('清除缓存失败，请重试');
    } finally {
      setClearingCache(false);
    }
  };

  // Token和API URL管理函数
  const handleOpenSettings = () => {
    setTokenInput(userToken || '');
    setApiUrlInput(userApiUrl || '');
    setShowSettings(true);
  };

  const handleSaveSettings = () => {
    if (tokenInput.trim()) {
      setUserToken(tokenInput.trim());
      setUserTokenState(tokenInput.trim());
    }
    
    if (apiUrlInput.trim()) {
      setUserApiUrl(apiUrlInput.trim());
      setUserApiUrlState(apiUrlInput.trim());
    }
    
    setShowSettings(false);
    setTokenInput('');
    setApiUrlInput('');
  };

  const handleClearSettings = () => {
    setUserToken('');
    setUserTokenState(null);
    setUserApiUrl('');
    setUserApiUrlState(null);
    setShowSettings(false);
    setTokenInput('');
    setApiUrlInput('');
  };

  const handlePdfFilesChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    console.log('文件选择触发，当前文件数:', pdfFiles.length);
    if (e.target.files) {
      const newFiles = Array.from(e.target.files).map(file => ({
        id: `${file.name}-${Date.now()}-${Math.random()}`,
        name: file.name,
        size: file.size,
        file: file,  // 保存完整的File对象
      }));
      console.log('新增文件:', newFiles.map(f => f.name));
      setPdfFiles(prev => [...prev, ...newFiles]);
    }
  }, [pdfFiles.length]);

  const handleTemplateFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setTemplateFile(e.target.files[0]);
      setUseDefaultTemplate(false);
    }
  }, []);

  const removePdfFile = useCallback((id: string) => {
    setPdfFiles(prev => prev.filter(f => f.id !== id));
    // 清空文件输入，允许重新选择
    if (pdfInputRef.current) {
      pdfInputRef.current.value = '';
    }
  }, []);

  const removeTemplateFile = useCallback(() => {
    setTemplateFile(null);
    setUseDefaultTemplate(true);
  }, []);

  /**
   * 分块上传单个文件
   */
  const uploadFileInChunks = async (file: File, onProgress?: (fileName: string, currentChunk: number, totalChunks: number) => void): Promise<string> => {
    const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const userId = getCurrentUserId();

    let fileId = '';
    let currentChunk = 0;

    // 上传每个块
    for (currentChunk = 0; currentChunk < totalChunks; currentChunk++) {
      const start = currentChunk * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const chunk = file.slice(start, end);

      const formData = new FormData();
      formData.append('chunk_index', currentChunk.toString());
      formData.append('total_chunks', totalChunks.toString());
      formData.append('chunk', chunk);
      formData.append('original_name', file.name);
      formData.append('user_id', userId);
      if (fileId) {
        formData.append('file_id', fileId);
      }

      const response = await fetch('/api/upload-chunk', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(`上传块 ${currentChunk} 失败: ${data.message}`);
      }

      // 保存file_id供后续块使用
      if (!fileId) {
        fileId = data.file_id;
      }

      // 更新进度
      if (onProgress) {
        onProgress(file.name, currentChunk + 1, totalChunks);
      }
    }

    // 通知服务端合并文件
    const completeResponse = await fetch('/api/upload-complete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        file_id: fileId,
        user_id: userId,
      }),
    });

    const completeData = await completeResponse.json();

    if (!completeData.success) {
      throw new Error(`合并文件失败: ${completeData.message}`);
    }

    return fileId;
  };

  const handleSubmit = useCallback(async () => {
    // 检查Token和API URL
    if (!hasUserToken() || !hasUserApiUrl()) {
      setError('请先设置OCR API Token和API URL才能提交任务');
      setShowSettings(true);
      return;
    }

    if (pdfFiles.length === 0) {
      setError('请至少上传一个文件');
      return;
    }

    setProcessing(true);
    setProgress(0);
    setError(null);
    setResult(null);
    
    // 只在新任务时清空日志，继续上传时保留之前的日志
    if (!isContinueUpload) {
      setProgressLogs([]);
    }

    try {
      const userId = getCurrentUserId();

      // 1. 分块上传所有PDF文件
      setProgressLogs(prev => [...prev, { message: '开始上传文件...', time: new Date().toLocaleTimeString() }]);

      const uploadedFileIds: string[] = [];
      let totalChunks = 0;
      let completedChunks = 0;

      // 计算总块数
      const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB
      for (const pdfFile of pdfFiles) {
        if (pdfFile.file) {
          totalChunks += Math.ceil(pdfFile.file.size / CHUNK_SIZE);
        }
      }

      // 串行上传每个文件
      for (let i = 0; i < pdfFiles.length; i++) {
        const pdfFile = pdfFiles[i];
        if (!pdfFile.file) continue;

        const fileId = await uploadFileInChunks(pdfFile.file, (fileName, currentChunk, fileTotalChunks) => {
          completedChunks++;
          const overallProgress = Math.round((completedChunks / totalChunks) * 30); // 上传占30%进度
          setProgress(overallProgress);
          setProgressLogs(prev => [
            ...prev,
            {
              message: `上传: ${fileName} (${currentChunk}/${fileTotalChunks})`,
              time: new Date().toLocaleTimeString(),
              fileName: fileName,
            }
          ]);
        });

        uploadedFileIds.push(fileId);
        setProgressLogs(prev => [
          ...prev,
          {
            message: `✓ 文件上传完成: ${pdfFile.name}`,
            time: new Date().toLocaleTimeString(),
            fileName: pdfFile.name,
          }
        ]);
      }

      // 2. 分块上传模板文件（如果有）
      let uploadedTemplateFileId: string | undefined;
      
      // 如果是继续上传且已有任务，检查是否需要上传新模板
      if (templateFile) {
        // 用户上传了新模板，使用新模板
        setProgressLogs(prev => [...prev, { message: '上传模板文件...', time: new Date().toLocaleTimeString() }]);
        uploadedTemplateFileId = await uploadFileInChunks(templateFile, (fileName, currentChunk, fileTotalChunks) => {
          setProgressLogs(prev => [
            ...prev,
            {
              message: `上传模板: ${fileName} (${currentChunk}/${fileTotalChunks})`,
              time: new Date().toLocaleTimeString(),
              fileName: fileName,
            }
          ]);
        });
      } else if (isContinueUpload && !useDefaultTemplate && existingTemplateName) {
        // 继续上传，使用任务已有的自定义模板
        setProgressLogs(prev => [...prev, { message: `使用任务已有模板: ${existingTemplateName}`, time: new Date().toLocaleTimeString() }]);
        // 不需要上传新模板，API会使用任务目录中的模板
      } else {
        // 使用默认模板
        setProgressLogs(prev => [...prev, { message: '使用默认模板', time: new Date().toLocaleTimeString() }]);
      }

      // 3. 检查文件数量，决定使用后台任务还是实时处理
      const FILE_THRESHOLD = 5;
      const useBackgroundTask = uploadedFileIds.length > FILE_THRESHOLD && !isContinueUpload;

      if (useBackgroundTask) {
        // 提交到后台任务
        setProgressLogs(prev => [...prev, { message: '提交后台任务...', time: new Date().toLocaleTimeString() }]);

        const requestData = {
          file_ids: uploadedFileIds,
          template_file_id: uploadedTemplateFileId,
          use_default_template: !templateFile,
          task_name: isContinueUpload ? '继续上传任务' : '招聘信息提取任务',
          priority: taskPriority,
          user_id: userId,
          ocr_token: getUserToken(),
          ocr_api_url: getUserApiUrl(),
        };
        
        console.log('[页面 - 提交后台任务] 当前选择的优先级:', taskPriority);
        console.log('[页面 - 提交后台任务] 请求数据:', JSON.stringify(requestData, null, 2));

        const response = await fetch('/api/submit-task', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            file_ids: uploadedFileIds,
            template_file_id: uploadedTemplateFileId,
            use_default_template: !templateFile && isContinueUpload ? !useDefaultTemplate : !templateFile,
            task_name: isContinueUpload ? '继续上传任务' : '招聘信息提取任务',
            task_id: isContinueUpload ? currentTaskId : undefined,  // 继续上传时传递当前任务ID
            priority: taskPriority,
            user_id: userId,
            ocr_token: getUserToken(),
            ocr_api_url: getUserApiUrl(),
          }),
        });

        const data = await response.json();

        if (!data.success) {
          throw new Error(data.message || '提交后台任务失败');
        }

        // 后台任务提交成功
        setResult({
          success: true,
          message: `${data.message}（优先级：${data.priority === 'high' ? '高' : data.priority === 'low' ? '低' : '普通'}）`,
          task_id: data.task_id,
        });

        setProgress(100);
        setProgressLogs(prev => [
          ...prev,
          {
            message: `✓ 任务已提交到后台（优先级：${data.priority}）`,
            time: new Date().toLocaleTimeString(),
          }
        ]);
        
        // 将当前文件移动到已提交列表
        setPdfFiles(currentPdfFiles => {
          const filesToSubmit = currentPdfFiles.map(f => ({
            ...f,
            file: undefined,
            submittedAt: new Date().toISOString()
          }));
          
          setSubmittedFiles(prev => {
            const existingNames = new Set(prev.map(f => f.name));
            const newFiles = filesToSubmit.filter(f => !existingNames.has(f.name));
            return [...prev, ...newFiles];
          });
          
          return [];
        });

        if (pdfInputRef.current) {
          pdfInputRef.current.value = '';
        }
        
        setProcessing(false);
        return;
      }

      // 文件数量<=5，使用实时处理
      setProgressLogs(prev => [...prev, { message: '开始实时处理...', time: new Date().toLocaleTimeString() }]);

      const response = await fetch('/api/process-uploaded-files', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          file_ids: uploadedFileIds,
          template_file_id: uploadedTemplateFileId,
          use_default_template: !templateFile,
          task_name: isContinueUpload ? '继续上传任务' : '招聘信息提取任务',
          task_id: currentTaskId || undefined,
          priority: taskPriority,
          user_id: userId,
          ocr_token: getUserToken(),
          ocr_api_url: getUserApiUrl(),
        }),
      });

      if (!response.ok) {
        throw new Error(`处理失败: ${response.statusText}`);
      }

      // 使用Reader读取流式响应
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('无法读取响应流');
      }

      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              
              // 更新 task_id
              if (data.task_id && data.task_id !== currentTaskId) {
                setCurrentTaskId(data.task_id);
                setIsContinueUpload(true);
              }
              
              // 添加进度日志
              const time = new Date().toLocaleTimeString('zh-CN', { 
                hour12: false, 
                hour: '2-digit', 
                minute: '2-digit', 
                second: '2-digit' 
              });
              
              setProgressLogs(prev => [...prev, { 
                message: data.message || data.step, 
                time,
                fileName: data.fileName,
                elapsedTime: data.elapsedTime
              }]);

              // 根据步骤更新进度
              const stepWeights: Record<string, number> = {
                init: 35,
                process: 50,
                ocr: 70,
                extract: 85,
                excel: 90,
                json: 95,
                complete: 100,
                error: 100,
              };

              if (stepWeights[data.step]) {
                setProgress(stepWeights[data.step]);
              }

              // 处理完成
              if (data.step === 'complete') {
                const taskId = data.task_id;
                
                if (taskId) {
                  setCurrentTaskId(taskId);
                  setIsContinueUpload(true);
                  
                  const taskResponse = await fetch(`/api/tasks/${taskId}?user_id=${encodeURIComponent(userId)}`);
                  const taskData = await taskResponse.json();
                  
                  if (taskData.success) {
                    const task = taskData.task;
                    setResult({
                      success: true,
                      message: data.message,
                      task_id: task.id,
                      excel_file: task.result_files?.excel,
                      json_file: task.result_files?.json,
                      records_count: task.records_count,
                      validation_summary: task.validation_summary,
                    });
                    
                    setPdfFiles(currentPdfFiles => {
                      const filesToSubmit = currentPdfFiles.map(f => ({
                        ...f,
                        file: undefined,
                        submittedAt: new Date().toISOString()
                      }));
                      
                      setSubmittedFiles(prev => {
                        const existingNames = new Set(prev.map(f => f.name));
                        const newFiles = filesToSubmit.filter(f => !existingNames.has(f.name));
                        return [...prev, ...newFiles];
                      });
                      
                      return [];
                    });
                    
                    if (pdfInputRef.current) {
                      pdfInputRef.current.value = '';
                    }
                  }
                }
              }

              // 处理错误
              if (data.step === 'error') {
                throw new Error(data.message);
              }
            } catch (e) {
              console.error('解析SSE数据失败:', e);
            }
          }
        }
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '处理失败';
      console.error('处理失败:', error);
      setError(errorMessage);
      setProgressLogs(prev => [
        ...prev,
        {
          message: `✗ 错误: ${errorMessage}`,
          time: new Date().toLocaleTimeString(),
        }
      ]);
    } finally {
      setProcessing(false);
    }
  }, [pdfFiles, templateFile, isContinueUpload, currentTaskId, taskPriority]);

  const downloadFile = useCallback(async (fileType: 'excel' | 'json', filename: string, taskId?: string) => {
    try {
      const userId = getCurrentUserId();
      const apiUrl = new URL('/api/download', window.location.origin);
      apiUrl.searchParams.append('file_type', fileType);
      apiUrl.searchParams.append('filename', filename);  // URLSearchParams会自动编码，不需要encodeURIComponent
      if (taskId) {
        apiUrl.searchParams.append('task_id', taskId);
      }
      apiUrl.searchParams.append('user_id', userId);
      
      const response = await fetch(apiUrl.toString());
      if (!response.ok) {
        throw new Error('下载失败');
      }

      const blob = await response.blob();
      const objectUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(objectUrl);
      document.body.removeChild(a);
    } catch (err) {
      console.error('下载失败:', err);
      alert('下载失败，请重试');
    }
  }, []);

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  };

  const previewJson = useCallback(async (filename: string, taskId?: string) => {
    setJsonPreviewLoading(true);
    setShowJsonPreview(true);
    
    try {
      const userId = getCurrentUserId();
      const apiUrl = new URL('/api/download', window.location.origin);
      apiUrl.searchParams.append('file_type', 'json');
      apiUrl.searchParams.append('filename', filename);
      if (taskId) {
        apiUrl.searchParams.append('task_id', taskId);
      }
      apiUrl.searchParams.append('user_id', userId);
      
      const response = await fetch(apiUrl.toString());
      if (!response.ok) {
        throw new Error('获取 JSON 数据失败');
      }

      const jsonData = await response.json();
      setJsonPreviewContent(jsonData);
    } catch (err) {
      console.error('获取 JSON 数据失败:', err);
      alert('获取 JSON 数据失败，请重试');
      setShowJsonPreview(false);
    } finally {
      setJsonPreviewLoading(false);
    }
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 p-4 md:p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="text-center flex-1">
            <h1 className="text-3xl md:text-4xl font-bold text-slate-900 dark:text-slate-100 mb-3">
              招聘报名信息提取系统
            </h1>
            <p className="text-slate-600 dark:text-slate-400 text-lg">
              使用PaddleOCR智能识别文档，自动抽取生成结构化数据
            </p>
          </div>
        </div>

        {/* Token和API URL设置区域 */}
        {(!userToken || !userApiUrl) ? (
          <Alert className="mb-6 border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20">
            <Key className="h-4 w-4" />
            <AlertDescription className="flex items-center justify-between">
              <span className="font-medium">请设置OCR API Token和API URL才能使用本系统</span>
              <Button
                size="sm"
                variant="default"
                onClick={handleOpenSettings}
                className="ml-4"
              >
                <Key className="w-4 h-4 mr-2" />
                设置配置
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          <div className="mb-6 bg-white dark:bg-slate-800 p-4 rounded-lg shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                  <Lock className="w-5 h-5 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    OCR API配置已设置
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Token: {showToken ? userToken : `${userToken!.slice(0, 8)}...${userToken!.slice(-4)}`} | 
                    URL: {userApiUrl}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowToken(!showToken)}
                  className="ml-2"
                >
                  {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleOpenSettings}
                >
                  修改配置
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleClearSettings}
                  className="text-red-600 hover:text-red-700"
                >
                  清除配置
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Token和API URL设置表单弹窗 */}
        {showSettings && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <Card className="w-full max-w-2xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Key className="w-5 h-5" />
                  设置OCR API配置
                </CardTitle>
                <CardDescription>
                  请输入您的PaddleOCR API Token和API URL。这些信息仅保存在本地浏览器中，用于调用OCR服务。
                  <a 
                    href="https://aistudio.baidu.com/paddleocr" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 underline ml-1"
                  >
                    如何获取API/Token？
                  </a>
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">API URL *</label>
                  <input
                    type="text"
                    value={apiUrlInput}
                    onChange={(e) => setApiUrlInput(e.target.value)}
                    placeholder="API URL，例如：https://******.aistudio-app.com/layout-parsing"
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">API Token *</label>
                  <div className="flex gap-2">
                    <input
                      type={showToken ? 'text' : 'password'}
                      value={tokenInput}
                      onChange={(e) => setTokenInput(e.target.value)}
                      placeholder="API Token"
                      className="flex-1 px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setShowToken(!showToken)}
                    >
                      {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowSettings(false);
                      setTokenInput('');
                      setApiUrlInput('');
                    }}
                  >
                    取消
                  </Button>
                  <Button
                    onClick={handleSaveSettings}
                    disabled={!tokenInput.trim() || !apiUrlInput.trim()}
                  >
                    保存
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* 任务操作按钮 */}
        <div className="flex items-center justify-between gap-3 mb-6 bg-white dark:bg-slate-800 p-4 rounded-lg shadow-sm">
          <div className="flex items-center gap-3">
            <Button
              variant={isContinueUpload ? "outline" : "default"}
              onClick={handleNewTask}
              disabled={processing}
              className="flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              新建任务
            </Button>
            {currentTaskId && (
              <Button
                variant={isContinueUpload ? "default" : "outline"}
                onClick={handleContinueUpload}
                disabled={processing}
                className="flex items-center gap-2"
              >
                <ArrowRightToLine className="w-4 h-4" />
                继续上传
              </Button>
            )}
            {isContinueUpload && currentTaskId && (
              <Badge variant="secondary" className="text-sm">
                当前任务ID: {currentTaskId.slice(-8)}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              onClick={(e) => {
                e.preventDefault();
                router.push('/tasks');
              }}
              className="flex items-center gap-2"
            >
              <FolderOpen className="w-4 h-4" />
              任务管理
            </Button>
            
            {/* 清除缓存按钮 */}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={clearingCache}
                  className="flex items-center gap-2"
                >
                  {clearingCache ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                  清除缓存
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>确认清除缓存</AlertDialogTitle>
                  <AlertDialogDescription>
                    确定要清空所有已缓存的OCR识别文件吗？此操作会删除 cache 目录下的所有文件，下次处理相同文件时需要重新进行OCR识别。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={clearingCache}>取消</AlertDialogCancel>
                  <AlertDialogAction onClick={handleClearCache} disabled={clearingCache}>
                    确认清空
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        {/* 第一行：PDF上传 + Excel模板 */}
        <div className="grid gap-6 md:grid-cols-2">
          {/* PDF文件上传 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5" />
                上传文档
              </CardTitle>
              <CardDescription>
                支持上传 PDF、JPEG、JPG、PNG、TIFF、TIF、BMP 格式文件，系统将自动提取文档信息
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-lg p-8 text-center hover:border-slate-400 dark:hover:border-slate-600 transition-colors">
                <input
                  type="file"
                  id="pdf-upload"
                  accept=".pdf,.jpeg,.jpg,.png,.tiff,.tif,.bmp"
                  multiple
                  onChange={handlePdfFilesChange}
                  className="hidden"
                  disabled={processing}
                  ref={pdfInputRef}
                />
                <label
                  htmlFor="pdf-upload"
                  className="flex flex-col items-center cursor-pointer"
                >
                  <Upload className="w-12 h-12 text-slate-400 mb-3" />
                  <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">
                    点击或拖拽上传文档
                  </p>
                  <p className="text-xs text-slate-500">支持 PDF、JPEG、JPG、PNG、TIFF、TIF、BMP，最大50MB</p>
                </label>
              </div>

              {pdfFiles.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-600 dark:text-slate-400 font-medium">
                      待提交文件 {pdfFiles.length} 个
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleClearFiles}
                      disabled={processing}
                      className="text-red-600 hover:text-red-700 h-6 px-2"
                    >
                      <X className="w-3 h-3 mr-1" />
                      清空待提交
                    </Button>
                  </div>
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {pdfFiles.map((file, index) => (
                      <div
                        key={file.id}
                        className="flex items-center justify-between p-2.5 bg-blue-50 dark:bg-blue-950 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900 transition-colors"
                      >
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <span className="text-xs text-blue-500 w-4 flex-shrink-0">{index + 1}.</span>
                          <FileText className="w-4 h-4 text-blue-400 flex-shrink-0" />
                          <span className="text-sm truncate" title={file.name}>{file.name}</span>
                          <span className="text-xs text-slate-500 flex-shrink-0 ml-2">
                            {formatFileSize(file.size)}
                          </span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removePdfFile(file.id)}
                          disabled={processing}
                          className="h-6 w-6 p-0 hover:text-red-600"
                          title="移除此文件"
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {submittedFiles.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                  <div className="text-sm text-slate-600 dark:text-slate-400 font-medium">
                    已提交文件 {submittedFiles.length} 个
                  </div>
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {submittedFiles.map((file, index) => (
                      <div
                        key={file.id}
                        className="flex items-center justify-between p-2.5 bg-green-50 dark:bg-green-950 rounded-lg transition-colors"
                      >
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                          <span className="text-sm truncate" title={file.name}>{file.name}</span>
                          <span className="text-xs text-slate-500 flex-shrink-0 ml-2">
                            {formatFileSize(file.size)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Excel模板上传 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5" />
                Excel模板配置
              </CardTitle>
              <CardDescription>
                可选：上传自定义Excel模板，或使用默认模板
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* 继续上传时显示已使用的自定义模板 */}
              {existingTemplateName && isContinueUpload && (
                <div className="flex items-center gap-2 p-3 bg-blue-50 dark:bg-blue-950 rounded-lg border border-blue-200 dark:border-blue-800">
                  <CheckCircle className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                  <span className="text-sm text-blue-700 dark:text-blue-300">
                    继续使用自定义模板：{existingTemplateName}
                  </span>
                </div>
              )}
              
              <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="use-default"
                    checked={useDefaultTemplate}
                    onChange={(e) => {
                      setUseDefaultTemplate(e.target.checked);
                      if (e.target.checked) {
                        setTemplateFile(null);
                      }
                    }}
                    disabled={processing}
                    className="w-4 h-4 rounded"
                  />
                  <label htmlFor="use-default" className="text-sm font-medium">
                    使用默认模板
                  </label>
                </div>
                <Badge variant="secondary">推荐</Badge>
              </div>

              {!useDefaultTemplate && (
                <div className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-lg p-6 text-center hover:border-slate-400 dark:hover:border-slate-600 transition-colors">
                  <input
                    type="file"
                    id="template-upload"
                    accept=".xlsx,.xls"
                    onChange={handleTemplateFileChange}
                    className="hidden"
                    disabled={processing}
                    ref={templateInputRef}
                  />
                  <label
                    htmlFor="template-upload"
                    className="flex flex-col items-center cursor-pointer"
                  >
                    <Upload className="w-8 h-8 text-slate-400 mb-2" />
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      点击上传Excel模板
                    </p>
                  </label>
                </div>
              )}

              {templateFile && (
                <div className="flex items-center justify-between p-3 bg-green-50 dark:bg-green-950 rounded-lg border border-green-200 dark:border-green-800">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <FileText className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0" />
                    <span className="text-sm font-medium text-green-700 dark:text-green-300 truncate" title={templateFile.name}>
                      {templateFile.name}
                    </span>
                    <span className="text-xs text-green-600 dark:text-green-400 flex-shrink-0">
                      {formatFileSize(templateFile.size)}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={removeTemplateFile}
                    disabled={processing}
                    className="h-6 w-6 p-0 hover:text-red-600"
                    title="移除模板"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* 第二行：任务优先级 */}
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Key className="w-5 h-5" />
              任务优先级
            </CardTitle>
            <CardDescription>
              选择后台任务的优先级，高优先级任务会优先处理
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">任务优先级</span>
              <Badge variant={taskPriority === 'high' ? 'destructive' : taskPriority === 'low' ? 'secondary' : 'default'}>
                当前选择: {taskPriority === 'high' ? '高' : taskPriority === 'low' ? '低' : '普通'}
              </Badge>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <button
                type="button"
                onClick={() => setTaskPriority('high')}
                disabled={processing}
                className={`p-4 rounded-lg border-2 transition-all ${
                  taskPriority === 'high'
                    ? 'border-red-500 bg-red-50 dark:bg-red-950'
                    : 'border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600'
                }`}
              >
                <div className="flex flex-col items-center gap-2">
                  <Badge variant="destructive" className={taskPriority === 'high' ? '' : 'opacity-50'}>
                    高
                  </Badge>
                  <span className="text-xs text-slate-600 dark:text-slate-400">紧急任务</span>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setTaskPriority('normal')}
                disabled={processing}
                className={`p-4 rounded-lg border-2 transition-all ${
                  taskPriority === 'normal'
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
                    : 'border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600'
                }`}
              >
                <div className="flex flex-col items-center gap-2">
                  <Badge variant="default" className={taskPriority === 'normal' ? '' : 'opacity-50'}>
                    普通
                  </Badge>
                  <span className="text-xs text-slate-600 dark:text-slate-400">日常任务</span>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setTaskPriority('low')}
                disabled={processing}
                className={`p-4 rounded-lg border-2 transition-all ${
                  taskPriority === 'low'
                    ? 'border-slate-500 bg-slate-50 dark:bg-slate-900'
                    : 'border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600'
                }`}
              >
                <div className="flex flex-col items-center gap-2">
                  <Badge variant="secondary" className={taskPriority === 'low' ? '' : 'opacity-50'}>
                    低
                  </Badge>
                  <span className="text-xs text-slate-600 dark:text-slate-400">批量任务</span>
                </div>
              </button>
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              <p>• <strong>高优先级</strong>：立即处理，适合少量紧急文件</p>
              <p>• <strong>普通优先级</strong>：正常处理顺序，适合常规任务</p>
              <p>• <strong>低优先级</strong>：空闲时处理，适合大批量文件</p>
            </div>
          </CardContent>
        </Card>

        {/* 提交按钮 */}
        <div className="mt-6 text-center">
          <Button
            size="lg"
            onClick={handleSubmit}
            disabled={processing || pdfFiles.length === 0 || !userToken}
            className="min-w-[200px]"
          >
            {processing ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                处理中...
              </>
            ) : (
              <>
                <Upload className="w-5 h-5 mr-2" />
                开始提取
              </>
            )}
          </Button>
        </div>

        {/* 进度条 */}
        {processing && (
          <div className="mt-6">
            <Progress value={progress} className="h-2" />
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-2 text-center">
              正在处理，请稍候...
            </p>
          </div>
        )}
            
        {/* 进度日志 */}
        {(processing || progressLogs.length > 0) && (
          <Card className="mt-4">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">处理日志</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="h-64 overflow-y-auto bg-slate-50 dark:bg-slate-900 rounded-md p-3 text-sm font-mono">
                {progressLogs.length === 0 ? (
                  <p className="text-slate-500 dark:text-slate-400">等待处理开始...</p>
                ) : (
                  <div className="space-y-1">
                    {progressLogs.map((log, index) => (
                      <div key={index} className="flex items-start gap-2 text-xs">
                        <span className="text-slate-500 dark:text-slate-400 flex-shrink-0 w-16">
                          {log.time}
                        </span>
                        <span className="text-slate-700 dark:text-slate-300 flex-1">
                          {log.fileName && (
                            <span className="text-blue-600 dark:text-blue-400 font-medium">
                              [{log.fileName}]
                            </span>
                          )}
                          {log.message}
                          {log.elapsedTime && (
                            <span className="text-slate-500 dark:text-slate-400 ml-2">
                              ({(log.elapsedTime / 1000).toFixed(2)}s)
                            </span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* 错误提示 */}
        {error && (
          <Alert variant="destructive" className="mt-6">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* 处理结果 */}
        {result && result.success && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-green-500" />
                处理完成
              </CardTitle>
              <CardDescription>{result.message}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* 校验结果摘要 */}
              {result.validation_summary && (
                <div className="grid grid-cols-3 gap-4">
                  <div className="p-4 bg-green-50 dark:bg-green-950 rounded-lg text-center">
                    <div className="text-2xl font-bold text-green-700 dark:text-green-400">
                      {result.validation_summary.ok}
                    </div>
                    <div className="text-sm text-green-600 dark:text-green-500 mt-1">
                      正常
                    </div>
                  </div>
                  <div className="p-4 bg-yellow-50 dark:bg-yellow-950 rounded-lg text-center">
                    <div className="text-2xl font-bold text-yellow-700 dark:text-yellow-400">
                      {result.validation_summary.warning}
                    </div>
                    <div className="text-sm text-yellow-600 dark:text-yellow-500 mt-1">
                      存疑（黄色）
                    </div>
                  </div>
                  <div className="p-4 bg-red-50 dark:bg-red-950 rounded-lg text-center">
                    <div className="text-2xl font-bold text-red-700 dark:text-red-400">
                      {result.validation_summary.error}
                    </div>
                    <div className="text-sm text-red-600 dark:text-red-500 mt-1">
                      错误（红色）
                    </div>
                  </div>
                </div>
              )}

              {/* 下载按钮 */}
              <div className="flex flex-wrap gap-4">
                {result.excel_file && (
                  <Button
                    onClick={() => downloadFile('excel', result.excel_file!, result.task_id)}
                    className="flex-1 min-w-[150px]"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    下载Excel
                  </Button>
                )}
                {result.json_file && (
                  <div className="flex gap-2 flex-1">
                    <Button
                      onClick={() => previewJson(result.json_file!, result.task_id)}
                      variant="secondary"
                      className="flex-1 min-w-[100px]"
                    >
                      <Eye className="w-4 h-4 mr-2" />
                      预览JSON
                    </Button>
                    <Button
                      onClick={() => downloadFile('json', result.json_file!, result.task_id)}
                      variant="outline"
                      className="flex-1 min-w-[100px]"
                    >
                      <Download className="w-4 h-4 mr-2" />
                      下载JSON
                    </Button>
                  </div>
                )}
              </div>

              {/* 说明文字 */}
              <div className="text-sm text-slate-600 dark:text-slate-400 space-y-2">
                <p><strong>颜色标记说明：</strong></p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li><span className="text-red-600 font-medium">红色</span>：数据格式错误，需要手动修正</li>
                  <li><span className="text-yellow-600 font-medium">黄色</span>：数据可能有问题，建议人工确认</li>
                  <li><span className="text-white font-medium">白色</span>：数据校验通过</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
      
      {/* JSON 预览模态框 */}
      <AlertDialog open={showJsonPreview} onOpenChange={setShowJsonPreview}>
        <AlertDialogContent className="max-w-4xl max-h-[80vh] flex flex-col overflow-hidden">
          <AlertDialogHeader className="flex-shrink-0">
            <AlertDialogTitle>JSON 数据预览</AlertDialogTitle>
            <AlertDialogDescription>
              共 {Array.isArray(jsonPreviewContent) ? jsonPreviewContent.length : 0} 条记录
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex-1 mt-4 overflow-auto bg-slate-50 dark:bg-slate-900 rounded-md p-4 min-h-0">
            {jsonPreviewLoading ? (
              <div className="flex items-center justify-center h-32">
                <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
              </div>
            ) : jsonPreviewContent ? (
              <pre className="text-xs font-mono whitespace-pre-wrap break-all">
                {JSON.stringify(jsonPreviewContent, null, 2)}
              </pre>
            ) : (
              <p className="text-slate-500">暂无数据</p>
            )}
          </div>
          <AlertDialogFooter className="flex-shrink-0 gap-2 pt-4">
            <Button
              variant="outline"
              onClick={() => {
                if (jsonPreviewContent) {
                  navigator.clipboard.writeText(JSON.stringify(jsonPreviewContent, null, 2));
                  alert('已复制到剪贴板');
                }
              }}
            >
              复制全部
            </Button>
            <Button onClick={() => setShowJsonPreview(false)}>
              关闭
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
