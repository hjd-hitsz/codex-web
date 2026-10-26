import React, { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  MessageSquare,
  Plus,
} from "lucide-react";
import { basename, newChat } from "./store";
import { IconButton } from "./workspace";

export function ProjectGroup({ path, children }) {
  const [open, expand] = useState(true);
  const label = path ? basename(path) : "未分类";
  return (
    <div className="project-group">
      <div className="project-heading">
        <button
          title={path || "未指定项目的对话"}
          onClick={() => expand(!open)}
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {path ? <Folder size={14} /> : <MessageSquare size={14} />}
          <span>{label}</span>
        </button>
        <IconButton
          icon={Plus}
          title={"在 " + label + " 中新建对话"}
          onClick={() => newChat(path)}
        />
      </div>
      {open && children}
    </div>
  );
}
