#!/bin/bash
# 反重力自动更新脚本（fork 模式）
# 从上游拉取更新，merge 到我们的 fork，冲突时保留我们的版本
# cron: 0 */3 * * *

set -e

cd /root/antigravity2api-nodejs
LOG_PREFIX="[$(date '+%Y-%m-%d %H:%M:%S')]"

# 拉取上游最新
git fetch upstream 2>&1

# 检查是否有新 commit
LOCAL=$(git rev-parse HEAD)
UPSTREAM=$(git rev-parse upstream/main)
MERGE_BASE=$(git merge-base HEAD upstream/main)

if [ "$UPSTREAM" = "$MERGE_BASE" ]; then
    echo "$LOG_PREFIX 上游无更新，跳过"
    exit 0
fi

echo "$LOG_PREFIX 检测到上游更新: $MERGE_BASE..$UPSTREAM"

# merge 上游，冲突时保留我们的版本
if git merge upstream/main -m "merge: 同步上游更新 $(date '+%Y-%m-%d')" --no-edit 2>&1; then
    echo "$LOG_PREFIX merge 成功（无冲突）"
else
    echo "$LOG_PREFIX merge 有冲突，使用我们的版本解决"
    # 对所有冲突文件使用我们的版本
    git diff --name-only --diff-filter=U | while read file; do
        echo "$LOG_PREFIX   冲突文件: $file → 保留我们的版本"
        git checkout --ours "$file"
        git add "$file"
    done
    git commit -m "merge: 同步上游更新（冲突已解决，保留自定义） $(date '+%Y-%m-%d')" --no-edit 2>&1
fi

# 推到我们的 fork
git push origin main 2>&1
echo "$LOG_PREFIX push 到 fork 完成"

# 重装依赖（如果 package.json 变了）
if git diff --name-only "$LOCAL" HEAD | grep -q "package.json"; then
    echo "$LOG_PREFIX package.json 变更，重装依赖"
    npm install --production 2>&1
fi

# 重启服务
echo "$LOG_PREFIX 重启 antigravity-huanhuan"
systemctl restart antigravity-huanhuan 2>&1
echo "$LOG_PREFIX 更新完成"
