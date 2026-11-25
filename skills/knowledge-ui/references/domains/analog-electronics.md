# 模拟电子技术笔记

先明确器件类型、端口、参考地、极性、温度与使用的模型。对 n 沟道增强型 MOSFET 的平方律示例，可从体端接源极、正向 `VDS` 的长沟道理想模型切入。给出阈值、忽略项和选用条件。线性区与饱和区在 `VDS = VGS − Vth` 接合，分别代入两段公式核对电流相等。用有限工作区间说明沟道夹断时漏极电流仍可为正，以及沟道长度调制只在所采用的模型近似条件下成立。

区分直流工作点和小信号局部线性化。注明数值量纲，例如安培、伏特和西门子。跨导是保持其它指定量不变时 `ID` 对 `VGS` 的局部偏导，适用幅度围绕选定工作点。把模型预测和具体器件数据表典型曲线对应到相同测试条件。

曲线用 `chart` 标出区间边界与工作点。电路图用 `svg` 和已注册的 `electronics` 符号，给连线、参考方向和引脚补充文字说明。符号坐标以当前源码检出中的 `src/extensions/electronics.ts` 声明及 `examples/extensions/gallery.md` 为准。

MOSFET 的沟道模型和适用边界可从逐渐沟道近似的推导核对。 [MIT 6.012 漏极电流模型](https://ocw.mit.edu/courses/6-012-microelectronic-devices-and-circuits-fall-2009/resources/mit6_012f09_lec11_drain/)
