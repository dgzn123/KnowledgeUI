import type { ExtensionPackage } from "#contracts";

export const common: ExtensionPackage = {
  namespace: "common",
  protocolVersion: 1,
  version: "1.0.0",
  templates: {
    "adjustable-value": {
      parameters: {
        seed: { type: "number", description: "初始值" },
        caption: { type: "string", default: "调整值" },
        unit: { type: "string", default: "" },
        showBaseline: { type: "boolean", default: true },
      },
      body: {
        type: "interactive",
        title: "{{caption}} · {{adjusted}}",
        state: { offset: { type: "number", label: "偏移量", default: 0, step: 1 } },
        computed: { adjusted: "seed + offset" },
        layout: {
          type: "stack",
          children: [
            { type: "number-input", bind: "offset" },
            { type: "metric", label: "初始值", value: "{{seed}}", unit: "{{unit}}", when: "showBaseline" },
            { type: "metric", label: "调整后", value: "{{adjusted}}", unit: "{{unit}}" },
          ],
        },
      },
    },
  },
};
