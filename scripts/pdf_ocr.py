#!/usr/bin/env python3
"""
文档OCR识别脚本
使用PaddleOCR-VL布局解析API识别PDF和图片中的文字内容
支持格式：PDF、JPEG、JPG、PNG、TIFF、TIF、BMP
"""

import os
import sys
import json
import base64
import requests
import io
from PIL import Image

# PaddleOCR-VL API配置
API_URL = None  # API URL必须通过命令行参数传入
TOKEN = None  # Token必须通过命令行参数传入

# 支持的文件类型
SUPPORTED_EXTENSIONS = {
    # PDF文件
    '.pdf': 'pdf',
    # 图片文件
    '.jpg': 'image',
    '.jpeg': 'image',
    '.png': 'image',
    '.tiff': 'image',
    '.tif': 'image',
    '.bmp': 'image',
}

# 需要转换为JPEG的图片格式
CONVERT_TO_JPEG = ['.png', '.tiff', '.tif', '.bmp']


def convert_image_to_jpeg(file_path):
    """
    将图片转换为JPEG格式
    
    Args:
        file_path: 图片文件路径
        
    Returns:
        bytes: JPEG格式的图片字节数据
    """
    try:
        # 打开图片
        with Image.open(file_path) as img:
            print(f"原始图片: {img.size}, 模式: {img.mode}", file=sys.stderr)
            
            # 检查图片尺寸，如果太大则缩放（API可能有大小限制）
            max_size = 4000  # 最大边长
            if max(img.size) > max_size:
                print(f"图片尺寸过大，进行缩放...", file=sys.stderr)
                ratio = max_size / max(img.size)
                new_size = tuple(int(dim * ratio) for dim in img.size)
                img = img.resize(new_size, Image.LANCZOS)
                print(f"缩放后尺寸: {img.size}", file=sys.stderr)
            
            # 转换为RGB模式（如果原图是RGBA等模式）
            if img.mode in ('RGBA', 'LA', 'P'):
                # 创建白色背景
                background = Image.new('RGB', img.size, (255, 255, 255))
                if img.mode == 'P':
                    img = img.convert('RGBA')
                background.paste(img, mask=img.split()[-1] if img.mode == 'RGBA' else None)
                img = background
            elif img.mode != 'RGB':
                img = img.convert('RGB')
            
            # 保存为JPEG格式到内存
            output = io.BytesIO()
            img.save(output, format='JPEG', quality=90)  # 降低质量以减小文件大小
            jpeg_data = output.getvalue()
            print(f"转换后JPEG大小: {len(jpeg_data)} bytes", file=sys.stderr)
            return jpeg_data
    except Exception as e:
        raise Exception(f"图片转换失败: {str(e)}")

def file_to_base64(file_path, convert_to_jpeg=False):
    """
    将文件读取并转换为base64编码
    
    Args:
        file_path: 文件路径
        convert_to_jpeg: 是否转换为JPEG格式（用于PNG、TIFF等格式）
        
    Returns:
        base64编码的字符串
    """
    try:
        if convert_to_jpeg:
            # 转换为JPEG再编码
            file_bytes = convert_image_to_jpeg(file_path)
            file_data = base64.b64encode(file_bytes).decode("ascii")
        else:
            # 直接读取文件
            with open(file_path, "rb") as file:
                file_bytes = file.read()
            file_data = base64.b64encode(file_bytes).decode("ascii")
        return file_data
    except Exception as e:
        raise Exception(f"文件读取失败: {str(e)}")


def call_layout_parsing_api(file_path):
    """
    调用PaddleOCR-VL布局解析API
    
    Args:
        file_path: 文件路径
        
    Returns:
        API返回的完整结果
    """
    # 验证Token和API URL
    if not TOKEN:
        raise Exception("Token未设置，请通过命令行参数传入Token")
    
    if not API_URL:
        raise Exception("API URL未设置，请通过命令行参数传入API URL")
    
    # 检查文件扩展名，判断是否需要转换为JPEG
    file_ext = os.path.splitext(file_path)[1].lower()
    convert_to_jpeg = file_ext in CONVERT_TO_JPEG
    
    # 检查文件大小（PDF可能有大小限制）
    file_size = os.path.getsize(file_path)
    print(f"文件大小: {file_size} bytes ({file_size / 1024 / 1024:.2f} MB)", file=sys.stderr)
    
    if file_ext == '.pdf' and file_size > 10 * 1024 * 1024:  # 10MB
        print(f"警告: PDF文件过大（{file_size / 1024 / 1024:.2f} MB），可能导致API调用失败", file=sys.stderr)
    
    # 读取文件并转为base64
    file_data = file_to_base64(file_path, convert_to_jpeg=convert_to_jpeg)
    
    # 检查base64数据大小
    print(f"Base64数据大小: {len(file_data)} bytes ({len(file_data) / 1024 / 1024:.2f} MB)", file=sys.stderr)
    
    if len(file_data) > 20 * 1024 * 1024:  # 20MB base64数据
        print(f"警告: Base64数据过大（{len(file_data) / 1024 / 1024:.2f} MB），可能导致API调用失败", file=sys.stderr)
    
    # 构建请求头
    headers = {
        "Authorization": f"token {TOKEN}",
        "Content-Type": "application/json"
    }
    
    # 构建请求体
    payload = {
        "file": file_data,
        "fileType": 0 if file_ext == '.pdf' else 1,  # PDF为0，图片为1
        "useDocOrientationClassify": False,
        "useDocUnwarping": False,
        "useChartRecognition": False,
    }
    
    try:
        print(f"正在调用API处理文件: {file_path}", file=sys.stderr)
        print(f"文件扩展名: {file_ext}", file=sys.stderr)
        print(f"文件类型参数: {payload['fileType']}", file=sys.stderr)
        print(f"Base64数据大小: {len(file_data)} bytes", file=sys.stderr)
        
        response = requests.post(API_URL, json=payload, headers=headers, timeout=120)
        
        # 检查HTTP状态码
        if response.status_code != 200:
            error_info = f"API调用失败，HTTP状态码: {response.status_code}"
            try:
                error_detail = response.json()
                error_info += f"，错误详情: {error_detail}"
            except:
                if response.text:
                    error_info += f"，响应内容: {response.text[:200]}"
            raise Exception(error_info)
        
        result = response.json()
        
        # 检查返回结果
        if "result" not in result:
            raise Exception(f"API返回格式错误: {result}")
        
        return result
        
    except requests.exceptions.RequestException as e:
        raise Exception(f"API调用失败: {str(e)}")


def extract_text_from_api_result(api_result):
    """
    从API结果中提取markdown文本
    
    Args:
        api_result: API返回的完整结果
        
    Returns:
        文本内容列表（每个元素是一个页面的markdown文本）
    """
    texts = []
    
    result = api_result.get("result", {})
    layout_results = result.get("layoutParsingResults", [])
    
    for idx, page_result in enumerate(layout_results):
        # 获取markdown文本
        markdown_data = page_result.get("markdown", {})
        page_text = markdown_data.get("text", "")
        
        texts.append({
            "page": idx + 1,
            "text": page_text
        })
    
    return texts


def process_file(file_path):
    """
    处理文件，返回OCR识别结果
    
    Args:
        file_path: 文件路径
        
    Returns:
        {
            "success": True/False,
            "pages": 页数,
            "results": [
                {
                    "page": 页码,
                    "text": 识别的markdown文本
                },
                ...
            ],
            "full_text": 所有页面的合并文本,
            "message": 错误信息（如果有）
        }
    """
    result = {
        "success": False,
        "pages": 0,
        "results": [],
        "full_text": "",
        "message": ""
    }
    
    # 检查文件是否存在
    if not os.path.exists(file_path):
        result["message"] = f"文件不存在: {file_path}"
        return result
    
    # 获取文件扩展名
    file_ext = os.path.splitext(file_path)[1].lower()
    
    # 检查文件类型是否支持
    if file_ext not in SUPPORTED_EXTENSIONS:
        result["message"] = f"不支持的文件格式: {file_ext}。支持的格式: {', '.join(SUPPORTED_EXTENSIONS.keys())}"
        return result
    
    try:
        # 调用OCR API处理PDF和图片
        api_result = call_layout_parsing_api(file_path)
        
        # 提取文本
        texts = extract_text_from_api_result(api_result)
        
        if len(texts) == 0:
            result["message"] = "API返回结果为空"
            return result
        
        # 填充结果
        result["success"] = True
        result["pages"] = len(texts)
        result["results"] = texts
        
        # 合并所有文本
        full_text = "\n\n".join([t["text"] for t in texts])
        result["full_text"] = full_text
        
        result["message"] = f"成功识别{len(texts)}页"
        
        return result
        
    except Exception as e:
        result["message"] = f"文件处理失败: {str(e)}"
        return result


def main():
    """
    命令行入口
    用法: python pdf_ocr.py <file_path> <token> [api_url]
    """
    if len(sys.argv) < 3:
        print("错误：缺少必要参数")
        print("用法: python pdf_ocr.py <file_path> <token> [api_url]")
        print("示例: python pdf_ocr.py ./document.pdf your_api_token https://your-api-url.com/ocr")
        print("支持格式: PDF、JPEG、JPG、PNG、TIFF、TIF、BMP")
        sys.exit(1)
    
    file_path = sys.argv[1]
    token = sys.argv[2]
    apiUrl = sys.argv[3] if len(sys.argv) > 3 else None
    
    # 设置Token和API URL
    global TOKEN, API_URL
    TOKEN = token
    API_URL = apiUrl
    
    # 处理文件
    result = process_file(file_path)
    
    # 输出结果（JSON格式）
    print(json.dumps(result, ensure_ascii=False, indent=2))
    
    # 返回退出码
    sys.exit(0 if result["success"] else 1)


if __name__ == "__main__":
    main()
