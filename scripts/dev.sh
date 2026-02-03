#!/bin/bash
set -Eeuo pipefail

PORT=5000
COZE_WORKSPACE_PATH="${COZE_WORKSPACE_PATH:-$(pwd)}"
NODE_ENV=development
DEPLOY_RUN_PORT=5000

cd "${COZE_WORKSPACE_PATH}"

kill_port_if_listening() {
    local pids
    pids=$(ss -H -lntp 2>/dev/null | awk -v port="${DEPLOY_RUN_PORT}" '$4 ~ ":"port"$"' | grep -o 'pid=[0-9]*' | cut -d= -f2 | paste -sd' ' - || true)
    if [[ -z "${pids}" ]]; then
      echo "Port ${DEPLOY_RUN_PORT} is free."
      return
    fi
    echo "Port ${DEPLOY_RUN_PORT} in use by PIDs: ${pids} (SIGKILL)"
    echo "${pids}" | xargs -I {} kill -9 {}
    sleep 1
    pids=$(ss -H -lntp 2>/dev/null | awk -v port="${DEPLOY_RUN_PORT}" '$4 ~ ":"port"$"' | grep -o 'pid=[0-9]*' | cut -d= -f2 | paste -sd' ' - || true)
    if [[ -n "${pids}" ]]; then
      echo "Warning: port ${DEPLOY_RUN_PORT} still busy after SIGKILL, PIDs: ${pids}"
    else
      echo "Port ${DEPLOY_RUN_PORT} cleared."
    fi
}

echo "Clearing port ${PORT} before start."
kill_port_if_listening

# 设置临时目录（开发环境使用项目根目录下的 temp）
export APP_TEMP_DIR="${COZE_WORKSPACE_PATH}/temp"

echo "Using temporary directory: ${APP_TEMP_DIR}"
echo "Creating temp directory structure..."
mkdir -p "${APP_TEMP_DIR}/tasks"
mkdir -p "${APP_TEMP_DIR}/cache"
mkdir -p "${APP_TEMP_DIR}/queue"
echo "✓ Created temp/tasks, temp/cache and temp/queue directories"

# 启动后台处理器
echo "Starting background task processor..."
node "${COZE_WORKSPACE_PATH}/scripts/background-processor.js" > /tmp/background-processor.log 2>&1 &
BG_PID=$!
echo "✓ Background processor started (PID: ${BG_PID})"

# 确保后台处理器在脚本退出时停止
trap "kill ${BG_PID} 2>/dev/null || true" EXIT

echo "Starting HTTP service on port ${PORT} for dev..."

npx next dev --webpack --port $PORT
