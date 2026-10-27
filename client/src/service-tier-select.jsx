import React from "react";
import { ChevronDown } from "lucide-react";
import { set, useStore } from "./store";
import { modelServiceTiers, resolveServiceTier } from "./service-tier";

export function ServiceTierSelect() {
  const s = useStore();
  const model = s.models.find((m) => m.model === s.model);
  const tier = resolveServiceTier(s.serviceTier, model);
  const tiers = modelServiceTiers(model);
  if (tier && !tiers.some((option) => option.id === tier))
    tiers.push({
      id: tier,
      name:
        { fast: "Fast", priority: "Fast", ultrafast: "Ultra Fast" }[tier] ||
        tier,
      description: "当前对话保存的速度档位",
    });
  return (
    <label
      className="select-control service-tier-select"
      data-accelerated={Boolean(tier)}
      title="速度设置应用于下一轮任务；Fast 模式会增加用量。补充消息沿用当前轮次速度。"
    >
      <select
        aria-label="速度模式"
        value={tier || ""}
        onChange={(e) => set({ serviceTier: e.target.value || null })}
      >
        <option value="">标准</option>
        {tiers.map((option) => (
          <option key={option.id} value={option.id} title={option.description}>
            {option.name}
          </option>
        ))}
      </select>
      <ChevronDown size={12} />
    </label>
  );
}
