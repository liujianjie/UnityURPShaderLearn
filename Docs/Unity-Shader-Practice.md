# Unity 与 Shader 实践

跨章节可复用的 Unity、URP、ShaderLab 和 HLSL 问答。涉及包内实现的例子以本仓库的 [URP 14.0.12](../Packages/manifest.json) 为准。

<a id="numeric-precision"></a>
## `half4`、`float4` 和旧教程的 `fixed3` 怎么选？

后缀数字是分量个数：`half4` 与 `float4` 都有四个分量，`half3` 与 `fixed3` 都有三个。`float` 是 32 位浮点；`half` 可以用 16 位精度，具体取决于平台和 Unity 的着色器编译设置，改成 `half` 不保证变快。实际用 FP16 时，`10000` 和 `10001` 舍入后可能无法区分。

颜色和单位方向通常可以先试 `half`；世界或裁剪空间位置、需要小偏移的纹理坐标和对误差敏感的计算优先用 `float`。`fixed` 是旧版 Unity 着色器常见的低精度类型，在支持这种精度的旧平台上范围约为 `−2` 到 `2`。迁移到 URP 的 `HLSLPROGRAM` 时，通常先把 `fixed3` 改为 `half3`，再根据效果评估。

参考：[Unity 2022.3：精度类型](https://docs.unity3d.com/2022.3/Documentation/Manual/SL-DataTypesAndPrecision.html)。

<a id="camera-position"></a>
## `_WorldSpaceCameraPos` 从哪里拿到值？

在 URP 14.0.12 的普通单眼渲染中，它是 `UnityInput.hlsl` 声明的 `float3` 全局变量。自定义 Shader 通过 `Core.hlsl → Input.hlsl → UnityInput.hlsl` 拿到声明。URP 准备相机时，从 `camera.transform.position` 取得世界坐标，再在 `ScriptableRenderer.cs` 通过 `cmd.SetGlobalVector` 传给 GPU，因此材质不需要声明同名 `Properties`。

在[第 9 章前向渲染示例](../Assets/Shaders/Chapter9/Chapter9-ForwardRendering.shader)中，`normalize(_WorldSpaceCameraPos - i.worldPos)` 得到从表面点指向相机位置的单位向量。这是透视视线方向的常用写法；如果 Shader 同时支持正交相机，用 URP 的 `GetWorldSpaceNormalizeViewDir` 取得与投影类型一致的方向。

<a id="saturate"></a>
## `saturate` 为什么常出现在灯光点积后？

`saturate(x)` 把数值限制在 `[0, 1]`。在 `saturate(dot(N, L))` 里，若 `N` 是单位表面法线、`L` 是从表面指向灯的单位方向，背光面的点积为负，截成 `0` 后不产生这盏灯的漫反射。它只截断结果，不能代替[归一化法线](Graphics-Fundamentals.md#interpolated-normal)。

<a id="usepass-fallback"></a>
## `UsePass` 和 `FallBack` 有什么区别？

- `UsePass "Universal Render Pipeline/Lit/ShadowCaster"` 把 URP Lit 中名为 `ShadowCaster` 的 Pass 借给当前 `SubShader`。最后一个斜线前是 Shader 声明名，后面是 Pass 的 `Name`。该 Pass 的 `LightMode` 让 URP 在生成阴影贴图时选中它。
- `FallBack` 在没有合适的 `SubShader` 时提供备选 Shader。字符串匹配对方的 `Shader "..."` 声明名。比如 URP 14.0.12 的错误 Shader 声明名是 `Hidden/Universal Render Pipeline/FallbackError`，可在装好的 URP 包内打开 `Shaders/Utils/FallbackError.shader` 核对。

借用 `ShadowCaster` 能让物体参与投影；物体自己是否接收实时阴影，由它的前向 Pass 决定。见[第 9 章阴影问答](Chapter09-Shadow-QA.md#35-问题-2getmainlightshadowcoord-与不传参数有什么区别)中的 `GetMainLight(shadowCoord)` 和衰减字段。
