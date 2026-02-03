#!/usr/bin/env node

/**
 * LLM信息提取脚本
 * 使用大语言模型从OCR文本中提取招聘报名信息
 */

const { LLMClient, Config } = require('coze-coding-dev-sdk');

/**
 * 主函数
 */
async function main() {
  // 解析命令行参数
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.error('Usage: node llm-extract.js <ocr_text_file> <template_headers_file> [record_index]');
    console.error('  ocr_text_file: 包含OCR文本的文件路径');
    console.error('  template_headers_file: 包含模板表头的文件（JSON数组）');
    console.error('  record_index: 记录索引（默认0）');
    process.exit(1);
  }
  
  const ocrTextFile = args[0];
  const templateHeadersFile = args[1];
  const recordIndex = args[2] ? parseInt(args[2]) : 0;
  
  // 读取OCR文本
  let ocrText = '';
  try {
    ocrText = require('fs').readFileSync(ocrTextFile, 'utf-8');
  } catch (error) {
    console.error(JSON.stringify({ success: false, error: `读取OCR文本失败: ${error.message}` }));
    process.exit(1);
  }
  
  // 读取模板表头
  let templateHeaders = [];
  try {
    const headersContent = require('fs').readFileSync(templateHeadersFile, 'utf-8');
    templateHeaders = JSON.parse(headersContent);
  } catch (error) {
    console.error(JSON.stringify({ success: false, error: `读取模板表头失败: ${error.message}` }));
    process.exit(1);
  }
  
  // 调用LLM进行信息提取
  try {
    const config = new Config();
    const client = new LLMClient(config);
    
    const headersStr = templateHeaders.join(', ');
    const systemPrompt = `你是一个专业的招聘报名信息提取专家。你的任务是从OCR识别的文本中提取招聘报名信息，并严格按照指定的Excel表头字段名生成JSON数据。

重要规则：
1. 必须严格按照提供的表头字段名生成JSON数据，字段名必须完全匹配（区分大小写）
2. 如果某个字段在文本中找不到对应信息，使用空字符串 "" 作为值
3. "序号"字段自动设置为 ${recordIndex + 1}
4. 确保提取的信息准确、完整
5. 对于日期格式，统一使用 YYYY-MM-DD 格式
6. 对于手机号，确保是11位数字
7. 对于身份证号，确保是18位（最后一位可以是X）
8. 直接返回JSON对象，不要有任何额外说明文字
9. 不要使用Markdown代码块（如 \`\`\`json），只返回纯JSON字符串

表头字段列表：${headersStr}`;
    
    const userPrompt = `请从以下OCR识别的文本中提取招聘报名信息：

${ocrText}

请严格按照表头字段名生成JSON数据，直接返回JSON字符串（不要使用代码块格式）。`;
    
    const response = await client.invoke(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      {
        model: 'doubao-seed-1-8-251228',
        temperature: 0.2,
      }
    );
    
    let content = response.content.trim();
    content = content.replace(/^```json\s*\n?/i, '');
    content = content.replace(/\n?```\s*$/i, '');
    content = content.trim();
    
    const extractedData = JSON.parse(content);
    extractedData['序号'] = recordIndex + 1;
    
    // 移除调试字段
    const resultData = {};
    for (const key in extractedData) {
      if (key !== 'full_text' && key !== '_raw_data') {
        resultData[key] = extractedData[key];
      }
    }
    
    console.log(JSON.stringify({ success: true, data: resultData }));
  } catch (error) {
    console.error(JSON.stringify({ success: false, error: `LLM提取失败: ${error.message}` }));
    process.exit(1);
  }
}

// 运行主函数
main().catch(error => {
  console.error(JSON.stringify({ success: false, error: `未捕获的异常: ${error.message}` }));
  process.exit(1);
});
