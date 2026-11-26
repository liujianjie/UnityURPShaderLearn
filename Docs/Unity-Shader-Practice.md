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

<a id="vertex-clip-position"></a>
## 为什么顶点着色器的 `SV_POSITION` 要写入裁剪坐标？

第 11 章的序列帧 Shader 把 `pos` 声明为 `float4 pos : SV_POSITION`，并在 `vert` 中写入 `TransformObjectToHClip(v.vertex)`。`SV_POSITION` 是 GPU 用来识别绘制位置的系统语义。顶点阶段输出四分量的齐次裁剪坐标，光栅化阶段据此裁掉三角形越出相机视野的部分，再除以 `w`、映射到视口并确定覆盖的像素。 [序列帧 Shader](../Assets/Shaders/Chapter11/Chapter11-ImageSequenceAnimation.shader) · [Direct3D 光栅化阶段](https://learn.microsoft.com/en-us/windows-hardware/drivers/display/rasterizer-block)

URP 14.0.12 的 `SpaceTransforms.hlsl` 用内层 `mul` 先把模型坐标变到世界空间，外层 `mul` 再乘包含视图和投影变换的 `UNITY_MATRIX_VP`，从世界空间到达裁剪空间。

```hlsl
return mul(GetWorldToHClipMatrix(), mul(GetObjectToWorldMatrix(), float4(positionOS, 1.0)));
```

例如固定场景里的一个点，向右平移相机并保持朝向，点的世界坐标保持原值，沿相机右轴的坐标却会减小，所以投影向画面左边移。 [URP 14 顶点变换示例](https://docs.unity3d.com/Packages/com.unity.render-pipelines.universal@14.0/manual/writing-shaders-urp-basic-unlit-structure.html) · [裁剪坐标怎样变成屏幕坐标](Graphics-Fundamentals.md#homogeneous-clip-space)

如果光照等计算需要在片元阶段读取世界坐标，本章示例可以在 `v2f` 中加上 `float3 positionWS : TEXCOORD1`。`TEXCOORD0` 已传 UV，`TEXCOORD1` 用来传三个世界坐标分量。`vert` 中先求世界坐标，再用它求 `SV_POSITION` 所需的裁剪坐标。

```hlsl
o.positionWS = TransformObjectToWorld(v.vertex.xyz);
o.pos = TransformWorldToHClip(o.positionWS);
```

GPU 在三角形的三个顶点之间插值，`frag(v2f i)` 可通过 `i.positionWS` 读取当前片元的世界坐标。

<a id="texcoord-channels"></a>
## 网格 UV 和 `TEXCOORD` 插值通道都是八个吗？

Unity 2022.3 的一个 Mesh 最多存八套 UV，每套为各个顶点保存一组坐标。顶点输入 `a2v` 的 `float2 texcoord : TEXCOORD0` 读取第一套 `UV0`，到 `TEXCOORD7` 读取第八套 `UV7`。各套 UV 由网格按需提供。 [Unity 2022.3 网格顶点数据](https://docs.unity3d.com/2022.3/Documentation/Manual/AnatomyofaMesh.html#uvs)

顶点输出 `v2f` 的 `float2 uv : TEXCOORD0` 则传递 `vert` 写进 `o.uv` 的值。这里的数字是顶点到片元的插值通道编号，数据来自顶点着色器的赋值。同一个 `v2f` 里的 `TEXCOORD1` 也可以用来传上一例计算的 `positionWS`。 [本章序列帧 Shader](../Assets/Shaders/Chapter11/Chapter11-ImageSequenceAnimation.shader) · [Unity 2022.3 Shader 语义](https://docs.unity3d.com/2022.3/Documentation/Manual/SL-ShaderSemantics.html)

插值器数量受编译目标和 GPU 限制。Unity 2022.3 默认的 `#pragma target 2.5` 按 8 个插值器编写，`target 3.0` 则要求至少 10 个。 [Unity 2022.3 Shader 编译目标](https://docs.unity3d.com/2022.3/Documentation/Manual/SL-ShaderCompileTargets.html#valid-target-values)

<a id="unpack-normal"></a>
## `UnpackNormal` 怎样把贴图通道还原成法线？

使用 0 到 1 的通道存放有符号的方向分量时，存入的值是 `分量 / 2 + 0.5`，读出时用 `2 × 通道值 − 1` 还原。比如 `0.5` 对应分量 `0`，`0.7` 对应分量 `0.4`。

URP 14.0.12 的 `ShaderLibrary/Packing.hlsl` 有多种分支。RG/AG 分支先用 `2 × (R × A, G) − 1` 还原 `x、y`。RG 布局令 `A = 1`，AG 布局令 `R = 1`。两种布局都只存切线空间的前两个分量，再按 `z = sqrt(1 − saturate(x² + y²))` 恢复朝外的分量，源码还对 `z` 设了极小的下限。RGB 分支对三个通道各做一次 `2c−1`。[Unity 2022.3 的 Packing.hlsl](https://github.com/Unity-Technologies/Graphics/blob/2022.3/staging/Packages/com.unity.render-pipelines.core/ShaderLibrary/Packing.hlsl) · [第 10 章的取样和解码算例](Chapter10-GlassRefraction-3D.html#decode)

两通道布局能补出 `z`，靠的是编码时约定法线长 `1` 且朝向表面外侧。设 `P` 是箭尾，`Q` 是箭头尖，`H` 是 `Q` 垂直到表面的落点。沿表面的 `PH² = x² + y²`，再由直角三角形 `PHQ` 得到 `HQ² = 1 − PH²`。开平方给出 `HQ` 的长度，朝外的约定决定沿 `+N` 取正值。[沿两幅图复算](Chapter10-GlassRefraction-3D.html#decode-foot)

<a id="saturate"></a>
## `saturate` 为什么常出现在灯光点积后？

`saturate(x)` 把数值限制在 `[0, 1]`。在 `saturate(dot(N, L))` 里，若 `N` 是单位表面法线、`L` 是从表面指向灯的单位方向，背光面的点积为负，截成 `0` 后不产生这盏灯的漫反射。它只截断结果，不能代替[归一化法线](Graphics-Fundamentals.md#interpolated-normal)。

<a id="usepass-fallback"></a>
## `UsePass` 和 `FallBack` 有什么区别？

- `UsePass "Universal Render Pipeline/Lit/ShadowCaster"` 把 URP Lit 中名为 `ShadowCaster` 的 Pass 借给当前 `SubShader`。最后一个斜线前是 Shader 声明名，后面是 Pass 的 `Name`。该 Pass 的 `LightMode` 让 URP 在生成阴影贴图时选中它。
- `FallBack` 在没有合适的 `SubShader` 时提供备选 Shader。字符串匹配对方的 `Shader "..."` 声明名。比如 URP 14.0.12 的错误 Shader 声明名是 `Hidden/Universal Render Pipeline/FallbackError`，可在装好的 URP 包内打开 `Shaders/Utils/FallbackError.shader` 核对。

借用 `ShadowCaster` 能让物体参与投影；物体自己是否接收实时阴影，由它的前向 Pass 决定。见[第 9 章阴影问答](Chapter09-Shadow-QA.md#35-问题-2getmainlightshadowcoord-与不传参数有什么区别)中的 `GetMainLight(shadowCoord)` 和衰减字段。

## 旧管线的 Bumped Diffuse / Bumped Specular 需要自己重写成 URP Shader 吗？

看目标是迁移材质效果，还是保留旧 Shader 的具体算法。[书里的 Bumped Diffuse](../Assets/Shaders/Common/BumpedDiffuse.shader) 用法线贴图改变每个像素参与光照计算的法线，输出环境光和漫反射；[Bumped Specular](../Assets/Shaders/Common/BumpedSpecular.shader) 还用同一条法线计算 Blinn–Phong 高光：法线越接近灯光方向与视线方向的半角向量，高光越强。两者都用 Built-in 的 `ForwardBase` / `ForwardAdd` Pass 标签，URP 14.0.12 的常规前向绘制不会按这两个标签执行它们。

常规不透明材质可以改用 [URP Simple Lit](https://docs.unity3d.com/Packages/com.unity.render-pipelines.universal@14.0/manual/simple-lit-shader.html)：把主贴图和染色迁到 Base Map，把法线贴图迁到 Normal Map。Bumped Diffuse 关闭 Specular Highlights；Bumped Specular 开启它，再按原来的 `_Specular` 设置高光颜色。旧 Shader 直接用 `_Gloss` 当高光指数；Simple Lit 从 Smoothness 算指数 `exp2(10 * smoothness + 1)`。如果只想对齐指数，用 `(log2(Gloss) - 1) / 10` 作为常量 Smoothness 的起点，再对照场景调整。

光照结果不保证完全一致；这个版本的 Simple Lit 还共用 Base Map 和 Normal Map 的 UV 缩放和偏移，旧 Shader 则可以分别设置。需要保留特定公式或独立 UV 时，再考虑移植自定义实现。

URP 14.0.12 的材质转换器按 Shader 声明名匹配，内置规则会把 `Legacy Shaders/Bumped Diffuse` 和 `Legacy Shaders/Bumped Specular` 转成 Simple Lit，并迁移 `_MainTex` 和 `_Color`。本项目的两个 Shader 使用 `Unity Shaders Book/Common/` 前缀，不会匹配这些规则；切换后要核对贴图、染色、Tiling/Offset 和高光设置。
