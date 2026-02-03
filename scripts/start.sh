#!/bin/bash
set -Eeuo pipefail

COZE_WORKSPACE_PATH="${COZE_WORKSPACE_PATH:-$(pwd)}"
PORT=5000
DEPLOY_RUN_PORT="${DEPLOY_RUN_PORT:-$PORT}"

start_service() {
    cd "${COZE_WORKSPACE_PATH}"
    
    # 检查是否在只读路径下（如 /opt/bytefaas）
    if [[ "${COZE_WORKSPACE_PATH}" == *"/opt/bytefaas"* ]]; then
        echo "⚠ Detected read-only filesystem path, using /tmp"
        export APP_TEMP_DIR="/tmp/app-temp"
    else
        # 尝试在项目根目录创建 temp 目录来测试是否可写
        test_dir="${COZE_WORKSPACE_PATH}/temp"
        if mkdir -p "${test_dir}" 2>/dev/null && touch "${test_dir}/.write_test" 2>/dev/null; then
            rm -f "${test_dir}/.write_test"
            export APP_TEMP_DIR="${COZE_WORKSPACE_PATH}/temp"
            echo "✓ Project root is writable, using ${APP_TEMP_DIR}"
        else
            rm -rf "${test_dir}" 2>/dev/null || true
            echo "⚠ Cannot write to project root, using /tmp"
            export APP_TEMP_DIR="/tmp/app-temp"
        fi
    fi
    
    echo "Using temporary directory: ${APP_TEMP_DIR}"
    echo "Project root: ${COZE_WORKSPACE_PATH}"
    
    echo "Ensuring temp directory structure exists..."
    mkdir -p "${APP_TEMP_DIR}/tasks"
    mkdir -p "${APP_TEMP_DIR}/cache"
    mkdir -p "${APP_TEMP_DIR}/queue"
    echo "✓ temp/tasks, temp/cache and temp/queue directories ready"
    
    # 启动后台处理器
    echo "Starting background task processor..."
    node "${COZE_WORKSPACE_PATH}/scripts/background-processor.js" > /tmp/background-processor.log 2>&1 &
    BG_PID=$!
    echo "✓ Background processor started (PID: ${BG_PID})"
    
    # 确保后台处理器在脚本退出时停止
    trap "kill ${BG_PID} 2>/dev/null || true" EXIT
    
    echo "Starting HTTP service on port ${DEPLOY_RUN_PORT} for deploy..."
    # 使用 env 命令确保环境变量被传递
    env APP_TEMP_DIR="${APP_TEMP_DIR}" npx next start --port ${DEPLOY_RUN_PORT}
}

echo "Starting HTTP service on port ${DEPLOY_RUN_PORT} for deploy..."
start_service
