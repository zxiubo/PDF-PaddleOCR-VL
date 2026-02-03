#!/usr/bin/env node

/**
 * 后台任务处理器
 * 监听任务队列并执行任务处理
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');

// 项目根目录
const PROJECT_ROOT = process.env.COZE_WORKSPACE_PATH || process.cwd();

/**
 * 获取临时目录
 */
function getTempDir() {
  // 优先使用 APP_TEMP_DIR 环境变量
  if (process.env.APP_TEMP_DIR) {
    return process.env.APP_TEMP_DIR;
  }
  
  const root = PROJECT_ROOT;
  
  // 强制检测：如果项目根目录在 /opt/bytefaas 下，使用 /tmp/app-temp
  if (root.includes('/opt/bytefaas')) {
    console.log('[DEBUG] Detected /opt/bytefaas in project root, using /tmp/app-temp');
    return path.join('/tmp', 'app-temp');
  }
  
  // 检查是否为只读文件系统
  const testDir = path.join(root, 'temp');
  try {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    fs.accessSync(testDir, fs.constants.W_OK);
    return testDir;
  } catch (err) {
    // 如果不可写，使用 /tmp/app-temp
    const fallbackDir = '/tmp/app-temp';
    if (!fs.existsSync(fallbackDir)) {
      fs.mkdirSync(fallbackDir, { recursive: true });
    }
    return fallbackDir;
  }
}

/**
 * 日志工具
 */
function log(level, message, taskId = null) {
  const timestamp = new Date().toISOString();
  const prefix = taskId ? `[${taskId}] ` : '';
  console.log(`[${timestamp}] [${level}] ${prefix}${message}`);
}

/**
 * 追加任务日志
 */
function appendTaskLog(taskId, message, userId) {
  const logFile = path.join(getTempDir(), 'tasks', userId, taskId, 'progress.log');
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${message}\n`;
  
  const logDir = path.dirname(logFile);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  
  fs.appendFileSync(logFile, logLine, 'utf-8');
}

/**
 * 获取队列目录
 */
function getQueueDir(priority, status) {
  const tempDir = getTempDir();
  const queueDir = path.join(tempDir, 'queue');
  
  if (!priority && !status) {
    return queueDir;
  }
  
  if (priority && status) {
    return path.join(queueDir, priority, status);
  }
  
  if (priority) {
    return path.join(queueDir, priority);
  }
  
  if (status) {
    return path.join(queueDir, status);
  }
  
  return queueDir;
}

/**
 * 获取用户缓存目录
 */
function getUserCacheDir(userId) {
  const tempDir = getTempDir();
  const cacheBaseDir = path.join(tempDir, 'cache');
  const cacheDir = path.join(cacheBaseDir, userId);
  
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  
  return cacheDir;
}

/**
 * 计算文件的MD5哈希值（从Buffer计算）
 */
function calculateFileHash(filePath) {
  const buffer = fs.readFileSync(filePath);
  const hash = crypto.createHash('md5');
  hash.update(buffer);
  return hash.digest('hex');
}

/**
 * 计算Buffer的MD5哈希值
 */
function calculateBufferHash(buffer) {
  const hash = crypto.createHash('md5');
  hash.update(buffer);
  return hash.digest('hex');
}

/**
 * 计算模板的MD5哈希值
 */
function calculateTemplateHash(templatePath) {
  let actualTemplatePath = templatePath;
  
  // 如果没有指定模板路径，使用默认模板
  if (!actualTemplatePath) {
    actualTemplatePath = path.join(PROJECT_ROOT, 'assets', '个人信息提取结果-模板.xlsx');
  }
  
  try {
    const buffer = fs.readFileSync(actualTemplatePath);
    const hash = crypto.createHash('md5');
    hash.update(buffer);
    return hash.digest('hex');
  } catch (error) {
    console.error('计算模板哈希失败:', error);
    return actualTemplatePath;  // 如果计算失败，使用路径作为唯一标识
  }
}

/**
 * 读取任务目录中的元数据
 */
function readTaskDirectoryMetadata(taskId, userId) {
  const taskDir = path.join(getTempDir(), 'tasks', userId, taskId);
  const metadataPath = path.join(taskDir, 'task.json');
  
  if (!fs.existsSync(metadataPath)) {
    return null;
  }
  
  try {
    const content = fs.readFileSync(metadataPath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`[TASK ${taskId}] 读取任务元数据失败:`, error);
    return null;
  }
}

/**
 * 保存任务目录中的元数据
 */
function saveTaskDirectoryMetadata(taskId, userId, metadata) {
  const taskDir = path.join(getTempDir(), 'tasks', userId, taskId);
  const metadataPath = path.join(taskDir, 'task.json');
  
  try {
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
    console.log(`[TASK ${taskId}] 任务元数据已更新到目录`);
  } catch (error) {
    console.error(`[TASK ${taskId}] 保存任务元数据失败:`, error);
  }
}

/**
 * 同步更新任务元数据（队列任务 + 任务目录）
 */
function syncTaskMetadata(task, priority) {
  // 1. 保存队列任务
  saveTask(task, priority);
  
  // 2. 读取并更新任务目录中的元数据
  const dirMetadata = readTaskDirectoryMetadata(task.id, task.user_id);
  if (dirMetadata) {
    // 更新关键字段
    dirMetadata.status = task.status;
    dirMetadata.progress = task.progress;
    dirMetadata.records_count = task.records_count;
    dirMetadata.message = task.message || `处理中: ${task.progress}%`;
    
    if (task.started_at) dirMetadata.started_at = task.started_at;
    if (task.completed_at) dirMetadata.completed_at = task.completed_at;
    if (task.elapsed_time) dirMetadata.elapsed_time = task.elapsed_time;
    if (task.error) dirMetadata.error = task.error;
    if (task.result_files) dirMetadata.result_files = task.result_files;
    // 同步 validation_summary 到根对象上（与直接处理逻辑一致）
    if (task.metadata && task.metadata.validation_summary) {
      dirMetadata.validation_summary = task.metadata.validation_summary;
    }
    
    // 保存回目录
    saveTaskDirectoryMetadata(task.id, task.user_id, dirMetadata);
  }
}

/**
 * 获取缓存文件路径
 */
function getCacheFilePath(userId, fileHash, templateHash) {
  const cacheDir = getUserCacheDir(userId);
  return path.join(cacheDir, `${fileHash}_${templateHash}.json`);
}

/**
 * 检查文件是否已解析（使用缓存）
 */
function isFileParsed(userId, fileHash, templateHash) {
  const cacheFilePath = getCacheFilePath(userId, fileHash, templateHash);
  
  if (!fs.existsSync(cacheFilePath)) {
    return null;
  }
  
  try {
    const content = fs.readFileSync(cacheFilePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error('读取缓存失败:', error);
    return null;
  }
}

/**
 * 保存解析结果到缓存
 */
function saveParsedRecord(userId, fileHash, templateHash, record) {
  const cacheFilePath = getCacheFilePath(userId, fileHash, templateHash);
  
  try {
    fs.writeFileSync(cacheFilePath, JSON.stringify(record, null, 2), 'utf-8');
  } catch (error) {
    console.error('保存缓存失败:', error);
  }
}

/**
 * 从队列中读取下一个任务
 */
function getNextTask() {
  const priorities = ['high', 'normal', 'low'];
  
  for (const priority of priorities) {
    const pendingDir = getQueueDir(priority, 'pending');
    
    if (!fs.existsSync(pendingDir)) {
      continue;
    }
    
    const files = fs.readdirSync(pendingDir)
      .filter(f => f.endsWith('.json'))
      .sort((a, b) => {
        // 按创建时间排序
        const taskA = loadTask(a.replace('.json', ''), priority, 'pending');
        const taskB = loadTask(b.replace('.json', ''), priority, 'pending');
        if (!taskA || !taskB) return 0;
        return new Date(taskA.created_at).getTime() - new Date(taskB.created_at).getTime();
      });
    
    if (files.length > 0) {
      const taskId = files[0].replace('.json', '');
      return loadTask(taskId, priority, 'pending');
    }
  }
  
  return null;
}

/**
 * 加载任务
 */
function loadTask(taskId, priority, status) {
  const taskFile = path.join(getQueueDir(priority, status), `${taskId}.json`);
  if (!fs.existsSync(taskFile)) {
    return null;
  }
  
  const data = fs.readFileSync(taskFile, 'utf-8');
  return JSON.parse(data);
}

/**
 * 保存任务
 * @param {Object} task - 任务对象
 * @param {string} priority - 任务优先级（可选，默认使用task.priority）
 */
function saveTask(task, priority) {
  const taskPriority = priority || task.priority;
  const taskDir = getQueueDir(taskPriority, task.status);
  const taskFile = path.join(taskDir, `${task.id}.json`);
  fs.writeFileSync(taskFile, JSON.stringify(task, null, 2), 'utf-8');
}

/**
 * 移动任务状态
 */
function moveTask(task, fromStatus, toStatus) {
  const fromFile = path.join(getQueueDir(task.priority, fromStatus), `${task.id}.json`);
  const toFile = path.join(getQueueDir(task.priority, toStatus), `${task.id}.json`);
  
  if (fs.existsSync(fromFile)) {
    fs.renameSync(fromFile, toFile);
  }
  
  task.status = toStatus;
  syncTaskMetadata(task, task.priority);
}

/**
 * 处理单个任务
 */
async function processTask(task) {
  const startTime = Date.now();
  
  log('info', `开始处理任务: ${task.name}`, task.id);
  appendTaskLog(task.id, '任务开始处理', task.user_id);
  
  // 初始化 metadata 对象
  if (!task.metadata) {
    task.metadata = {};
  }
  
  try {
    // 更新任务状态为 processing
    moveTask(task, 'pending', 'processing');
    task.started_at = new Date().toISOString();
    task.status = 'processing';
    syncTaskMetadata(task, task.priority);
    appendTaskLog(task.id, `任务状态更新为: processing`, task.user_id);
    
    // 创建任务目录
    const taskDir = path.join(getTempDir(), 'tasks', task.user_id, task.id);
    const uploadsDir = path.join(taskDir, 'uploads');
    const resultsDir = path.join(taskDir, 'results');
    
    [uploadsDir, resultsDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
    
    // 处理文件
    let successCount = 0;
    let failCount = 0;

    // 如果是继续上传，读取任务的已有记录
    let existingRecords = [];
    if (task.records && task.records.length > 0) {
      existingRecords = task.records;
      console.log(`[TASK ${task.id}] 已加载已有记录 ${existingRecords.length} 条`);
      appendTaskLog(task.id, `已加载已有记录 ${existingRecords.length} 条`, task.user_id);
    }

    const allRecords = [...existingRecords]; // 收集所有提取的记录（包括已有记录）
    console.log(`[TASK ${task.id}] 初始化 allRecords，记录数: ${allRecords.length}`);
    
    // 计算模板哈希（用于缓存）
    const templateHash = calculateTemplateHash(task.template);
    
    for (let i = 0; i < task.files.length; i++) {
      const filePath = task.files[i];
      const fileName = path.basename(filePath);
      
      try {
        appendTaskLog(task.id, `正在处理文件 ${i + 1}/${task.files.length}: ${fileName}`, task.user_id);
        const startedAt = Date.now();
        
        // 检查缓存
        const fileStartTime = Date.now();
        const fileHash = calculateFileHash(filePath);
        console.log(`[TASK ${task.id}] File hash for ${fileName}:`, fileHash);
        console.log(`[TASK ${task.id}] Template hash:`, templateHash);
        
        const cachedRecord = isFileParsed(task.user_id, fileHash, templateHash);
        let extractedData;
        
        if (cachedRecord) {
          console.log(`[TASK ${task.id}] Cache hit for ${fileName}!`);
          appendTaskLog(task.id, `使用缓存数据: ${fileName}`, task.user_id);
          extractedData = cachedRecord;
          const cacheElapsedTime = Date.now() - fileStartTime;
          appendTaskLog(task.id, `缓存加载完成: ${fileName} (${(cacheElapsedTime / 1000).toFixed(2)}s)`, task.user_id);
        } else {
          console.log(`[TASK ${task.id}] Cache miss for ${fileName}, performing OCR...`);
          // OCR 识别
          console.log(`[TASK ${task.id}] Starting OCR for file: ${fileName}`);
          
          // OCR 识别
          const ocrStartTime = Date.now();
          const ocrResult = await performOCR(filePath, task.ocr_token, task.ocr_api_url);
          
          console.log(`[TASK ${task.id}] OCR result:`, ocrResult.success ? 'SUCCESS' : 'FAILED');
          
          if (!ocrResult.success) {
            throw new Error(`OCR识别失败: ${ocrResult.message}`);
          }
          
          const ocrElapsedTime = Date.now() - ocrStartTime;
          appendTaskLog(task.id, `OCR识别完成: ${fileName} (${(ocrElapsedTime / 1000).toFixed(2)}s)`, task.user_id);
          
          // 信息提取
          const extractStartTime = Date.now();
          extractedData = await extractRecruitmentInfo(
            ocrResult.full_text,
            task.template_headers,
            task.records_count + i,
            taskDir
          );
          
          const extractElapsedTime = Date.now() - extractStartTime;
          appendTaskLog(task.id, `信息提取完成: ${fileName} (${(extractElapsedTime / 1000).toFixed(2)}s)`, task.user_id);
          
          // 保存缓存
          saveParsedRecord(task.user_id, fileHash, templateHash, extractedData);
        }
        
        // 收集提取的数据
        allRecords.push(extractedData);
        
        // 更新文件状态
        if (!task.file_statuses) {
          task.file_statuses = [];
        }
        task.file_statuses.push({
          fileName,
          savedName: path.basename(filePath),
          status: 'completed',
          startedAt: startedAt,
          completedAt: Date.now(),
          elapsedTime: Date.now() - startedAt
        });
        
        successCount++;
        task.records_count++;
        
        // 更新进度
        task.progress = Math.round((i + 1) / task.files.length * 100);
        syncTaskMetadata(task, task.priority);
        
      } catch (error) {
        log('error', `处理文件失败: ${fileName} - ${error.message}`, task.id);
        appendTaskLog(task.id, `处理文件失败: ${fileName} - ${error.message}`, task.user_id);
        
        // 记录失败状态
        if (!task.file_statuses) {
          task.file_statuses = [];
        }
        task.file_statuses.push({
          fileName,
          savedName: path.basename(filePath),
          status: 'failed',
          error: error.message,
          retryCount: 0
        });
        
        failCount++;
      }
    }
    
    // 生成 Excel 和 JSON
    appendTaskLog(task.id, '正在生成结果文件...', task.user_id);
    console.log(`[TASK ${task.id}] 开始生成结果文件，成功处理文件数: ${successCount}`);
    
    if (successCount > 0) {
      // 先保存JSON文件（用于Excel生成）
      const tempJsonPath = path.join(resultsDir, 'temp_records.json');
      console.log(`[TASK ${task.id}] 保存临时JSON到: ${tempJsonPath}`);
      fs.writeFileSync(tempJsonPath, JSON.stringify(allRecords, null, 2), 'utf-8');
      console.log(`[TASK ${task.id}] 临时JSON已保存，记录数: ${allRecords.length}`);
      
      // 调用 excel_filler.py 脚本生成Excel
      try {
        appendTaskLog(task.id, '正在生成Excel文件...', task.user_id);
        console.log(`[TASK ${task.id}] 调用 excel_filler.py 生成Excel...`);
        
        const excelScriptPath = path.join(PROJECT_ROOT, 'scripts', 'excel_filler.py');
        const excelPath = path.join(resultsDir, 'result.xlsx');
        const jsonPath = path.join(resultsDir, 'result.json');
        
        console.log(`[TASK ${task.id}] excelScriptPath: ${excelScriptPath}`);
        console.log(`[TASK ${task.id}] excelPath: ${excelPath}`);
        console.log(`[TASK ${task.id}] jsonPath: ${jsonPath}`);
        
        // 构建命令行参数
        let cmd = `python3 "${excelScriptPath}" "${tempJsonPath}"`;
        
        // 添加模板路径（如果有）
        if (task.template && fs.existsSync(task.template)) {
          console.log(`[TASK ${task.id}] 使用模板: ${task.template}`);
          cmd += ` --template "${task.template}"`;
        }
        
        // 添加输出路径
        cmd += ` "${excelPath}"`;
        
        // 添加JSON输出路径
        cmd += ` --json-output "${jsonPath}"`;
        
        console.log(`[TASK ${task.id}] Excel generation command:`, cmd);
        
        // 使用 Promise 包装 exec 调用
        const excelResult = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Excel生成超时（5分钟）'));
          }, 300000);
          
          exec(cmd, { cwd: PROJECT_ROOT, timeout: 300000 }, (error, stdout, stderr) => {
            clearTimeout(timeout);
            
            if (error) {
              reject(new Error(`Excel生成失败: ${stderr || error.message}`));
              return;
            }
            
            resolve({
              success: true,
              stdout,
              stderr
            });
          });
        });
        
        console.log(`[TASK ${task.id}] Excel generation completed:`, excelResult.success);
        console.log(`[TASK ${task.id}] Excel generation stdout:`, excelResult.stdout);
        console.log(`[TASK ${task.id}] Excel generation stderr:`, excelResult.stderr);
        
        if (excelResult.success) {
          appendTaskLog(task.id, `Excel文件生成成功: result.xlsx`, task.user_id);
          appendTaskLog(task.id, `JSON文件生成成功: result.json`, task.user_id);
          
          // 验证文件是否真的生成
          if (fs.existsSync(excelPath)) {
            console.log(`[TASK ${task.id}] Excel文件已存在: ${excelPath}`);
          } else {
            console.error(`[TASK ${task.id}] Excel文件未生成: ${excelPath}`);
          }
          
          if (fs.existsSync(jsonPath)) {
            console.log(`[TASK ${task.id}] JSON文件已存在: ${jsonPath}`);
          } else {
            console.error(`[TASK ${task.id}] JSON文件未生成: ${jsonPath}`);
          }
          
          // 解析返回结果（校验摘要）
          if (excelResult.stdout) {
            try {
              const excelOutput = JSON.parse(excelResult.stdout);
              console.log(`[TASK ${task.id}] 解析Excel输出:`, excelOutput);
              if (excelOutput.success) {
                task.metadata.validation_summary = excelOutput.validation_summary;
                appendTaskLog(task.id, `校验摘要: ${JSON.stringify(excelOutput.validation_summary)}`, task.user_id);
              }
            } catch (e) {
              console.log('解析Excel输出失败:', e);
            }
          }
        } else {
          appendTaskLog(task.id, `Excel生成失败: ${excelResult.message}`, task.user_id);
          console.error('Excel生成失败:', excelResult);
        }
        
      } catch (error) {
        console.error('Excel生成异常:', error);
        appendTaskLog(task.id, `Excel生成异常: ${error.message}`, task.user_id);
      } finally {
        // 删除临时JSON文件
        if (fs.existsSync(tempJsonPath)) {
          fs.unlinkSync(tempJsonPath);
        }
      }
    }
    
    // 任务完成
    task.completed_at = new Date().toISOString();
    task.elapsed_time = Date.now() - startTime;
    task.status = successCount > 0 ? 'completed' : 'failed';
    task.error = failCount > 0 ? `${failCount} 个文件处理失败` : null;
    
    // 保存结果文件信息到任务元数据
    if (successCount > 0) {
      task.result_files = {
        json: 'result.json',
        excel: 'result.xlsx'
      };
    }
    
    moveTask(task, 'processing', 'completed');
    
    // 更新任务目录中的元数据
    const taskMetadataPath = path.join(taskDir, 'task.json');
    if (fs.existsSync(taskMetadataPath)) {
      try {
        const taskMetadata = JSON.parse(fs.readFileSync(taskMetadataPath, 'utf-8'));
        taskMetadata.status = task.status;
        taskMetadata.completed_at = task.completed_at;
        taskMetadata.elapsed_time = task.elapsed_time;
        taskMetadata.records_count = task.records_count;
        taskMetadata.progress = task.progress;
        taskMetadata.error = task.error;
        taskMetadata.records = allRecords; // 更新记录数组（包含已有记录和新记录）
        if (task.result_files) {
          taskMetadata.result_files = task.result_files;
        }
        if (task.metadata && task.metadata.validation_summary) {
          taskMetadata.validation_summary = task.metadata.validation_summary;
        }
        fs.writeFileSync(taskMetadataPath, JSON.stringify(taskMetadata, null, 2), 'utf-8');
      } catch (error) {
        log('error', `更新任务元数据失败: ${error.message}`, task.id);
      }
    }
    
    appendTaskLog(task.id, `任务完成: 成功 ${successCount} 个，失败 ${failCount} 个，总耗时 ${(task.elapsed_time / 1000).toFixed(2)}s`, task.user_id);
    log('info', `任务完成: ${task.name}, 成功: ${successCount}, 失败: ${failCount}`, task.id);
    
  } catch (error) {
    log('error', `任务处理失败: ${error.message}`, task.id);
    appendTaskLog(task.id, `任务失败: ${error.message}`, task.user_id);
    
    task.status = 'failed';
    task.error = error.message;
    task.completed_at = new Date().toISOString();
    task.elapsed_time = Date.now() - startTime;
    
    moveTask(task, 'processing', 'completed');
  }
}

/**
 * OCR 识别
 */
async function performOCR(filePath, token, apiUrl) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(PROJECT_ROOT, 'scripts', 'pdf_ocr.py');
    let command = `python3 ${scriptPath} "${filePath}" "${token}"`;
    if (apiUrl) {
      command += ` "${apiUrl}"`;
    }
    
    // 设置超时时间（120秒）
    const timeout = setTimeout(() => {
      reject(new Error('OCR识别超时（120秒）'));
    }, 120000);
    
    exec(command, { cwd: PROJECT_ROOT, timeout: 120000 }, (error, stdout, stderr) => {
      clearTimeout(timeout);
      
      if (error) {
        const errorMsg = `OCR执行失败: ${stderr || error.message}`;
        console.error('[OCR ERROR]', errorMsg);
        console.error('[OCR STDERR]', stderr);
        console.error('[OCR STDOUT]', stdout?.substring(0, 500));
        reject(new Error(errorMsg));
        return;
      }
      
      if (stderr && !stdout) {
        console.error('[OCR STDERR ONLY]', stderr);
        reject(new Error(stderr));
        return;
      }
      
      if (!stdout || stdout.trim().length === 0) {
        console.error('[OCR EMPTY OUTPUT]');
        reject(new Error('OCR返回空结果'));
        return;
      }
      
      try {
        const result = JSON.parse(stdout);
        console.log('[OCR SUCCESS]', `识别完成，结果长度: ${stdout.length}`);
        resolve(result);
      } catch (parseError) {
        console.error('[OCR PARSE ERROR]', parseError.message);
        console.error('[OCR OUTPUT]', stdout?.substring(0, 500));
        reject(new Error(`OCR结果解析失败: ${parseError.message}`));
      }
    });
  });
}

/**
 * 信息提取（调用 LLM）
 */
async function extractRecruitmentInfo(text, headers, recordIndex, taskDir) {
  return new Promise((resolve, reject) => {
    // 创建临时文件
    const ocrTextFile = path.join(taskDir, `ocr_${recordIndex}.txt`);
    const headersFile = path.join(taskDir, `headers.json`);
    
    try {
      // 写入OCR文本
      fs.writeFileSync(ocrTextFile, text, 'utf-8');
      fs.writeFileSync(headersFile, JSON.stringify(headers), 'utf-8');
      
      const command = `node "${path.join(PROJECT_ROOT, 'scripts', 'llm-extract.js')}" "${ocrTextFile}" "${headersFile}" "${recordIndex}"`;
      
      // 设置超时时间（180秒）
      const timeout = setTimeout(() => {
        // 清理临时文件
        try {
          if (fs.existsSync(ocrTextFile)) fs.unlinkSync(ocrTextFile);
          if (fs.existsSync(headersFile)) fs.unlinkSync(headersFile);
        } catch (cleanupError) {
          console.error('清理临时文件失败:', cleanupError);
        }
        reject(new Error('LLM提取超时（180秒）'));
      }, 180000);
      
      exec(command, { cwd: PROJECT_ROOT, timeout: 180000 }, (error, stdout, stderr) => {
        clearTimeout(timeout);
        
        // 清理临时文件
        try {
          if (fs.existsSync(ocrTextFile)) fs.unlinkSync(ocrTextFile);
          if (fs.existsSync(headersFile)) fs.unlinkSync(headersFile);
        } catch (cleanupError) {
          console.error('清理临时文件失败:', cleanupError);
        }
        
        if (error) {
          const errorMsg = `LLM提取失败: ${stderr || error.message}`;
          console.error('[LLM ERROR]', errorMsg);
          console.error('[LLM STDERR]', stderr);
          reject(new Error(errorMsg));
          return;
        }
        
        if (stderr && !stdout) {
          console.error('[LLM STDERR ONLY]', stderr);
          reject(new Error(stderr));
          return;
        }
        
        if (!stdout || stdout.trim().length === 0) {
          console.error('[LLM EMPTY OUTPUT]');
          reject(new Error('LLM返回空结果'));
          return;
        }
        
        try {
          const result = JSON.parse(stdout);
          console.log('[LLM SUCCESS]', `提取完成`);
          if (result.success) {
            resolve(result.data);
          } else {
            reject(new Error(result.error || 'LLM提取失败'));
          }
        } catch (parseError) {
          console.error('[LLM PARSE ERROR]', parseError.message);
          console.error('[LLM OUTPUT]', stdout?.substring(0, 500));
          reject(new Error(`LLM结果解析失败: ${parseError.message}`));
        }
      });
    } catch (error) {
      console.error('[LLM SETUP ERROR]', error.message);
      reject(error);
    }
  });
}

/**
 * 主循环
 */
let running = true;
const MAX_CONCURRENT = 5;
const processingTasks = new Set();

/**
 * 恢复卡住的任务（在processing状态但没有被处理的任务）
 */
function recoverStuckTasks() {
  const priorities = ['high', 'normal', 'low'];
  
  for (const priority of priorities) {
    const processingDir = getQueueDir(priority, 'processing');
    
    if (!fs.existsSync(processingDir)) {
      continue;
    }
    
    const files = fs.readdirSync(processingDir)
      .filter(f => f.endsWith('.json'));
    
    for (const file of files) {
      const taskId = file.replace('.json', '');
      // 如果任务不在processingTasks集合中，说明它卡住了
      if (!processingTasks.has(taskId)) {
        const taskFile = path.join(processingDir, file);
        try {
          const taskData = JSON.parse(fs.readFileSync(taskFile, 'utf-8'));
          log('warning', `发现卡住的任务: ${taskData.name} (${taskId})`);
          
          // 将任务移回pending状态
          const pendingFile = path.join(getQueueDir(priority, 'pending'), file);
          fs.renameSync(taskFile, pendingFile);
          log('info', `任务已恢复到pending状态: ${taskId}`);
        } catch (error) {
          log('error', `恢复任务失败: ${taskId} - ${error.message}`);
        }
      }
    }
  }
}

async function mainLoop() {
  log('info', '后台处理器启动');
  
  // 启动时恢复卡住的任务
  recoverStuckTasks();
  
  while (running) {
    try {
      // 检查是否有待处理任务
      if (processingTasks.size < MAX_CONCURRENT) {
        const task = getNextTask();
        
        if (task) {
          processingTasks.add(task.id);
          log('info', `获取到任务: ${task.name} (当前并发: ${processingTasks.size}/${MAX_CONCURRENT})`);
          
          // 异步处理任务
          processTask(task).catch(err => {
            log('error', `任务处理异常: ${err.message}`, task.id);
          }).finally(() => {
            processingTasks.delete(task.id);
            log('info', `任务结束: ${task.name} (当前并发: ${processingTasks.size}/${MAX_CONCURRENT})`);
          });
        }
      }
      
      // 等待 1 秒后继续检查
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (error) {
      log('error', `主循环异常: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

/**
 * 优雅退出
 */
process.on('SIGTERM', () => {
  log('info', '收到 SIGTERM 信号，准备退出...');
  running = false;
  setTimeout(() => {
    log('info', '后台处理器已停止');
    process.exit(0);
  }, 5000);
});

process.on('SIGINT', () => {
  log('info', '收到 SIGINT 信号，准备退出...');
  running = false;
  setTimeout(() => {
    log('info', '后台处理器已停止');
    process.exit(0);
  }, 5000);
});

// 启动主循环
mainLoop();
