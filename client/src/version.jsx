import React from "react";
import { useStore } from "./store";

const labels = {
  release: "正式发布",
  development: "开发构建",
  unknown: "来源未知",
};

function BuildDetails({ title, info }) {
  return (
    <div className="build-details">
      <strong>{title}</strong>
      <span>
        {info.displayVersion} · {labels[info.channel]}
      </span>
      <small>
        提交：{info.revision || "未知"}
        {info.dirty ? "（含未提交修改）" : ""}
      </small>
      {info.builtAt && (
        <small>
          构建时间：{new Date(info.builtAt).toLocaleString("zh-CN")}
        </small>
      )}
    </div>
  );
}

export function VersionDetails() {
  const { serverVersion } = useStore();
  return (
    <div className="version-details">
      <BuildDetails title="网页" info={__CODEX_WEB_BUILD__} />
      {serverVersion ? (
        <BuildDetails title="桥接服务" info={serverVersion} />
      ) : (
        <p className="section-description">桥接版本信息等待连接后获取。</p>
      )}
    </div>
  );
}
