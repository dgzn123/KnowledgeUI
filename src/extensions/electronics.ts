import type { ExtensionPackage, JsonObject } from "#contracts";

const line = (x1: number, y1: number, x2: number, y2: number): JsonObject =>
  ({ kind: "line", x1, y1, x2, y2, stroke: "current", strokeWidth: 2 });

const polyline = (...points: readonly (readonly [number, number])[]): JsonObject =>
  ({ kind: "polyline", points: points.map(([x, y]) => ({ x, y })), stroke: "current", strokeWidth: 2, fill: "none" });

export const electronics: ExtensionPackage = {
  namespace: "electronics",
  protocolVersion: 1,
  version: "1.0.0",
  symbols: {
    resistor: {
      viewBox: "0 0 100 40",
      elements: [
        polyline([0, 20], [20, 20], [25, 10], [35, 30], [45, 10], [55, 30], [65, 10], [75, 30], [80, 20], [100, 20]),
      ],
    },
    capacitor: {
      viewBox: "0 0 100 40",
      elements: [line(0, 20, 44, 20), line(44, 7, 44, 33), line(56, 7, 56, 33), line(56, 20, 100, 20)],
    },
    mosfet: {
      // Enhancement-mode n-channel MOSFET with body tied to source.
      viewBox: "0 0 60 60",
      elements: [
        polyline([0, 30], [19, 30]), line(19, 14, 19, 46),
        line(26, 14, 26, 23), line(26, 26, 26, 34), line(26, 37, 26, 46),
        polyline([26, 18], [43, 18], [43, 0]),
        polyline([26, 42], [43, 42], [43, 60]),
        polyline([26, 30], [43, 30], [43, 42]),
        polyline([34, 27], [29, 30], [34, 33]),
      ],
    },
    "op-amp": {
      viewBox: "0 0 80 60",
      elements: [
        {
          kind: "polygon", points: [{ x: 16, y: 6 }, { x: 16, y: 54 }, { x: 64, y: 30 }],
          stroke: "current", strokeWidth: 2, fill: "none",
        },
        line(0, 19, 16, 19), line(0, 41, 16, 41), line(64, 30, 80, 30),
        line(20, 19, 30, 19), line(25, 14, 25, 24), line(20, 41, 30, 41),
      ],
    },
    ground: {
      viewBox: "0 0 40 32",
      elements: [line(20, 0, 20, 14), line(6, 14, 34, 14), line(11, 20, 29, 20), line(16, 26, 24, 26)],
    },
  },
};
