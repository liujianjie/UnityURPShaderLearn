# Chapter 9：URP 阴影 Shader 问答

相关文件：

- [Chapter 9 前向渲染学习笔记](Chapter09-ForwardRendering.md)
- [Chapter9-Shadow.shader](../Assets/Shaders/Chapter9/Chapter9-Shadow.shader)

本文对应项目版本：Unity `2022.3.62f3`、URP `14.0.12`。

本文默认已经理解对象空间、世界空间、齐次裁剪空间，以及基本的 Lambert 和 Blinn-Phong 前向光照，重点解释阴影数据如何进入光照计算，以及为什么同一个 Shader 需要两个 Pass。

## 1. 先建立整体认识：阴影不是在一次绘制中完成的

实时阴影至少包含两个阶段：

```text
阶段 A：从灯光视角绘制
网格 -> ShadowCaster Pass -> 阴影贴图（主要记录离灯最近的深度）

阶段 B：从相机视角绘制
网格 -> UniversalForward Pass
     -> 计算当前表面点的阴影坐标
     -> 查询阴影贴图，得到 shadowAttenuation
     -> 计算并输出屏幕颜色
```

所以这个 Shader 中的两个 Pass 不是二选一：

- `ShadowCaster` 负责提供“谁挡住了光”的数据。
- `UniversalForward` 负责使用这些数据，决定当前表面点的直接光要被压暗多少。

同一盏灯的阴影贴图会汇总所有参与该次阴影绘制的投影物体，并不是某个物体只给自己使用。一个物体的 `ShadowCaster` 可以让另一个物体的 `UniversalForward` 查询到它造成的遮挡。

最终颜色可以先概括成：

```hlsl
最终颜色 = 环境光
         + (漫反射 + 镜面高光)
         * 距离衰减
         * 阴影衰减;
```

阴影通常只削弱直接光，不削弱环境光或其他间接光。否则一个点进入阴影后会连环境照明也消失，结果往往黑得不自然。

## 2. Shader 最外层代码在组织什么

### 2.1 `Properties`

```shaderlab
Properties
{
    _Diffuse ("Diffuse", Color) = (1, 1, 1, 1)
    _Specular ("Specular", Color) = (1, 1, 1, 1)
    _Gloss ("Gloss", Range(8.0, 256)) = 20
    [Toggle(_AdditionalLights)]
    _AddLights ("AddLights", Float) = 1
}
```

`Properties` 负责让材质保存这些属性，并把它们显示在 Inspector 中。

`[Toggle(_AdditionalLights)]` 除了显示勾选框，还会让材质在勾选时启用关键字 `_AdditionalLights`。这个关键字随后控制附加光循环是否编译进当前材质所用的 Shader 变体。

必须特别注意大小写：

```text
_AdditionalLights   当前 Shader 自己定义的材质开关
_ADDITIONAL_LIGHTS  URP 管线定义和选择的关键字
```

HLSL 预处理关键字区分大小写，它们不是同一个关键字。

### 2.2 `SubShader` 标签

```shaderlab
Tags
{
    "RenderPipeline" = "UniversalPipeline"
    "RenderType" = "Opaque"
}
```

- `RenderPipeline = UniversalPipeline`：只让 URP 使用这个 `SubShader`。
- `RenderType = Opaque`：把它归类为不透明物体。当前 Shader 没有真正的透明度裁剪代码，因此这个分类是合理的。

### 2.3 为什么使用 `HLSLINCLUDE`

`HLSLINCLUDE ... ENDHLSL` 中的声明会被下面两个 Pass 共同看到。当前文件借此共享：

- URP 的核心与光照函数。
- `UnityPerMaterial` 材质常量缓冲区。
- `a2v` 和 `v2f` 结构体。

它的作用是共享代码，并不代表两个 Pass 会合并成一次绘制。

### 2.4 `a2v` 与 `v2f`

```hlsl
struct a2v
{
    float4 vertex : POSITION;
    float3 normal : NORMAL;
    float4 tangent : TANGENT;
};

struct v2f
{
    float4 pos : SV_POSITION;
    float3 worldNormal : TEXCOORD0;
    float3 worldPos : TEXCOORD1;
};
```

- `a2v` 是网格送入顶点着色器的数据，位置、法线、切线都从对象空间开始。
- `v2f` 是顶点着色器送往光栅化器和片元着色器的数据。
- `SV_POSITION` 告诉 GPU：`pos` 是光栅化所需的齐次裁剪空间位置。
- `TEXCOORD0/1` 在这里不是说数据一定是纹理坐标；它们只是用于传递自定义插值数据的通道。

## 3. `UniversalForward` Pass 在做什么

### 3.1 `LightMode = UniversalForward`

```shaderlab
Tags { "LightMode" = "UniversalForward" }
```

URP 从相机视角进行前向渲染时，会查找带有这个 `LightMode` 的 Pass。这个 Pass 的片元着色器最终返回屏幕颜色。

### 3.2 问题 1：这么多 `multi_compile` 都要用到吗？

先说结论：不是所有自定义 Shader 都必须照抄这些行。每一组关键字都应该对应一个确实要支持的运行时分支；支持的功能越多，变体越多。

当前前向 Pass 的关键字是：

```hlsl
#pragma shader_feature _AdditionalLights
#pragma multi_compile _ _MAIN_LIGHT_SHADOWS _MAIN_LIGHT_SHADOWS_CASCADE _MAIN_LIGHT_SHADOWS_SCREEN
#pragma multi_compile _ _SHADOWS_SOFT
```

#### `multi_compile` 到底做了什么

它不是“运行到这一行时打开功能”，而是让 Unity 预先把同一段 Shader 编译成多个版本。例如：

```hlsl
#pragma multi_compile _ _SHADOWS_SOFT
```

会产生两个候选版本：

1. `_SHADOWS_SOFT` 没有定义，走硬阴影相关代码。
2. `_SHADOWS_SOFT` 已定义，走软阴影相关代码。

其中 `_` 表示“这一选项不定义任何关键字”。运行时 URP 再根据管线设置选择合适的版本。

多行的选项数量会相乘。当前前向 Pass 在剥离无用变体之前，单看这三组就是：

```text
2 × 4 × 2 = 16 个组合
```

这里的第一个 `2` 来自 `shader_feature _AdditionalLights`。它与 `multi_compile` 都会产生变体；主要差别是构建时 Unity 可以根据材质使用情况剥离未使用的 `shader_feature` 变体，而 `multi_compile` 用于管线或运行时可能动态选择的组合。

#### 每一行是否需要

| 关键字组 | 作用 | 当前 Shader 是否需要 |
| --- | --- | --- |
| `_MAIN_LIGHT_SHADOWS`、`_MAIN_LIGHT_SHADOWS_CASCADE`、`_MAIN_LIGHT_SHADOWS_SCREEN` | 支持主光无阴影、普通阴影、级联阴影和屏幕空间阴影 | 要接收主光阴影就需要相应选项。放在同一行表示互斥，比拆成多行清楚 |
| `_SHADOWS_SOFT` | 让阴影采样支持软阴影 | URP 资产可能在硬/软阴影间切换时需要；只做硬阴影的固定练习可以去掉 |
| `_AdditionalLights` | 当前 Shader 自定义的材质开关 | 希望每个材质单独决定是否执行附加光循环时保留，否则可以重新设计 |

原文件还声明过：

```hlsl
#pragma multi_compile _ _ADDITIONAL_LIGHTS_VERTEX _ADDITIONAL_LIGHTS
```

但当前附加光循环只读取小驼峰材质关键字 `_AdditionalLights`，没有读取这两个大写 URP 关键字，也没有实现逐顶点分支，所以这组 pragma 只会增加无效组合。目标 Shader 中已经删除；若以后要真正跟随 URP 的逐顶点/逐像素设置，应先实现对应代码路径，再恢复这组变体。

URP 14.0.12 的 `TransformWorldToShadowCoord` 会在 `_MAIN_LIGHT_SHADOWS_SCREEN` 分支内根据世界位置自行计算标准化屏幕坐标，所以当前写法可以保留屏幕空间阴影变体，不需要由 `v2f` 额外传一份屏幕坐标。

如果练习目标只剩“方向光主阴影”，完整兼容 URP 主光阴影模式的关键字组就是：

```hlsl
#pragma multi_compile _ _MAIN_LIGHT_SHADOWS _MAIN_LIGHT_SHADOWS_CASCADE _MAIN_LIGHT_SHADOWS_SCREEN
```

项目明确不使用 Screen Space Shadows 时，可以删掉 `_MAIN_LIGHT_SHADOWS_SCREEN`；再明确关闭级联阴影时，才能继续缩成 `_ _MAIN_LIGHT_SHADOWS`。是否保留 `_SHADOWS_SOFT` 则取决于是否允许软阴影。

原代码还把级联关键字写成了：

```text
_MAIN_LIGHT_SHADOWS_CACADE
```

正确拼写是：

```text
_MAIN_LIGHT_SHADOWS_CASCADE
```

关键字必须完全匹配 URP 源码中的名字，拼错后 URP 的级联阴影代码不会进入对应分支。目标 Shader 中已经修正。

### 3.3 顶点着色器为什么这样写

```hlsl
VertexPositionInputs positionInputs = GetVertexPositionInputs(v.vertex.xyz);
o.pos = positionInputs.positionCS;
o.worldPos = positionInputs.positionWS;

VertexNormalInputs normalInputs = GetVertexNormalInputs(v.normal, v.tangent);
o.worldNormal = NormalizeNormalPerVertex(normalInputs.normalWS);
```

这里一次准备了片元阶段需要的三类数据：

- `positionCS`：GPU 光栅化三角形必须使用。
- `positionWS`：计算观察方向、查附加光、计算阴影坐标时使用。
- `normalWS`：计算 `N·L` 和 `N·H` 时使用。

顶点之间的法线会被插值，插值结果长度可能不再严格等于 `1`，所以片元着色器中又调用了 `NormalizeNormalPerPixel`。顶点阶段归一化不能替代片元阶段归一化。

### 3.4 阴影坐标是什么

```hlsl
float4 shadowCoord = TransformWorldToShadowCoord(i.worldPos);
```

相机正在着色的是世界空间点 `P`。要知道 `P` 是否被某个物体挡住，需要把 `P` 变换到主光阴影贴图所使用的坐标系，再用这个位置查询阴影贴图。

概念上，查询会比较：

```text
阴影贴图记录的最近遮挡深度
与
当前表面点 P 到灯光的深度
```

如果 `P` 比阴影贴图中记录的遮挡物更远，说明灯光先撞到了别的表面，`P` 就处于阴影中。

### 3.5 问题 2：`GetMainLight(shadowCoord)` 与不传参数有什么区别？

URP 14.0.12 的 `Light` 结构体包含：

```hlsl
struct Light
{
    half3 direction;
    half3 color;
    float distanceAttenuation;
    half shadowAttenuation;
    uint layerMask;
};
```

两个重载的核心逻辑可以简化成：

```hlsl
Light GetMainLight()
{
    Light light;
    light.direction = ...;
    light.color = ...;
    light.distanceAttenuation = ...;
    light.shadowAttenuation = 1.0;
    return light;
}

Light GetMainLight(float4 shadowCoord)
{
    Light light = GetMainLight();
    light.shadowAttenuation = MainLightRealtimeShadow(shadowCoord);
    return light;
}
```

所以差别非常集中：

| 调用 | 方向、颜色、距离衰减 | `shadowAttenuation` |
| --- | --- | --- |
| `GetMainLight()` | 有 | 初始化为 `1`，即不考虑实时阴影 |
| `GetMainLight(shadowCoord)` | 同样有 | 根据该阴影坐标查询主光阴影 |

带阴影参数的版本不是“只返回阴影”，而是先得到完整的主光数据，再额外填好阴影衰减。因此它当然仍然可以提供 `direction` 和 `color` 来计算漫反射与镜面高光。

当前光照关系是：

```hlsl
half3 diffuse = mainLight.color * _Diffuse.rgb * max(0, dot(N, L));
half3 specular = mainLight.color * _Specular.rgb * pow(max(0, dot(N, H)), _Gloss);

half attenuation = mainLight.distanceAttenuation
                 * mainLight.shadowAttenuation;

half3 color = ambient + (diffuse + specular) * attenuation;
```

字段的分工是：

- `direction`、`color` 决定直接光的方向和颜色。
- `distanceAttenuation` 决定距离、聚光范围或剔除造成的衰减。主光通常是方向光，因此一般不是普通意义上的距离平方衰减。
- `shadowAttenuation` 决定遮挡造成的衰减：`1` 表示完全受光，`0` 表示完全被挡住，软阴影边缘可以是中间值。
- `ambient` 来自球谐环境光数据，不是 `mainLight` 的字段，也不应因为改用有阴影的重载而消失。

原代码虽然调用了 `GetMainLight(shadowCoord)`，却只把 `distanceAttenuation` 乘进颜色，等于查询了阴影但没有使用查询结果。目标 Shader 中已经改为同时乘上 `mainLight.shadowAttenuation`。

#### 它等价于 Built-in 管线的 `TRANSFER_SHADOW` 吗？

不等价。旧的 Built-in 管线通常分成两步：

```text
TRANSFER_SHADOW(o)       生成并传递阴影坐标
SHADOW_ATTENUATION(i)    用阴影坐标采样，得到阴影值
```

当前 URP 写法也是两步，只是 API 不同：

```text
TransformWorldToShadowCoord(positionWS)  生成阴影坐标
GetMainLight(shadowCoord)                返回完整主光，并填好阴影衰减
```

### 3.6 附加光循环目前支持到什么程度

```hlsl
Light light = GetAdditionalLight(index, i.worldPos);
```

这个两参数重载提供附加光方向、颜色和距离/聚光衰减，但在 URP 14 源码中把 `shadowAttenuation` 保持为 `1`。当前代码也只乘了 `light.distanceAttenuation`，因此目前计算的是“无实时阴影的附加光”。

当前项目三个 URP Renderer Asset 都使用普通 Forward 模式，这个 `GetAdditionalLightsCount()` 加普通 `for` 循环可以工作；它不兼容 Forward+。URP 14 在 Forward+ 下让 `GetAdditionalLightsCount()` 返回 `0`，需要改用 URP 的集群灯光遍历宏，并增加 `_FORWARD_PLUS` 变体。

若以后要让点光源、聚光灯也产生并被接收实时阴影，还需要同时补齐：

- `_ADDITIONAL_LIGHT_SHADOWS` 变体。
- 能查询阴影的 `GetAdditionalLight` 重载或相应阴影函数。
- `light.shadowAttenuation` 对直接光的乘法。
- 支持点光/聚光的标准 `ShadowCaster` 顶点路径。

这部分不属于当前最小修改，所以只在代码注释和本文中标明限制，没有顺手扩展功能。

## 4. 问题 3：`SV_TARGET` 还是 `SV_Target`？

建议统一写：

```hlsl
SV_Target
```

它是片元着色器输出颜色的系统值语义；`SV_Target0` 与 `SV_Target` 等价，`SV_Target1` 等用于多渲染目标。

在当前 Unity/URP 环境中，`SV_TARGET` 也能工作，URP 14 自己的 `ShadowCasterPass.hlsl` 就使用了全大写写法；Unity 手册和 Microsoft 的语义表则通常写成 `SV_Target`。因此这里主要是统一风格，不是两种不同功能。目标 Shader 已统一为 `SV_Target`。

不要把这件事类推到 Shader 关键字：`_AdditionalLights` 与 `_ADDITIONAL_LIGHTS` 是预处理标识符，大小写不同就确实是两个名字。

## 5. `ShadowCaster` Pass 在做什么

### 5.1 渲染状态

```shaderlab
Cull Off
ZWrite On
ZTest LEqual
```

- `Cull Off`：正反面都投射阴影，适合纸片、围栏、树叶卡片等薄片模型。封闭模型通常也可以使用默认的 `Cull Back`。
- `ZWrite On`：把离灯最近的深度写进阴影贴图。
- `ZTest LEqual`：只有更靠近灯光的片元才能更新当前深度。

### 5.2 问题 4：`#pragma shader_feature _ALPHATEST_ON` 是什么意思？

它声明两个材质变体：

```text
变体 A：未定义 _ALPHATEST_ON
变体 B：定义了 _ALPHATEST_ON
```

名字 `_ALPHATEST_ON` 只是约定俗成的关键字。真正让低透明度像素消失的是 Shader 中的裁剪代码，例如：

```hlsl
#if defined(_ALPHATEST_ON)
    half alpha = SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap, i.uv).a;
    clip(alpha - _Cutoff);
#endif
```

`clip(x)` 在 `x < 0` 时丢弃当前片元。把相同裁剪放进 `ShadowCaster` Pass 后，栅栏或叶片纹理中的透明洞才不会投下整块矩形阴影。

当前 Shader 没有 `_BaseMap`、UV、`_Cutoff`，片元函数里也没有 `clip()`，因此：

```text
#pragma shader_feature _ALPHATEST_ON
```

目前只会声明变体，不会产生任何可见效果。对于当前纯不透明 Shader 可以删除；如果后续要学习镂空阴影，则应保留并补齐采样与裁剪代码。

当前 `Properties` 中也没有驱动 `_ALPHATEST_ON` 的开关。后续实现时，可以增加类似 `[Toggle(_ALPHATEST_ON)]` 的材质属性，或者由材质代码启用该关键字；但无论如何，仍然必须配合实际的 `clip()` 分支。若打包后才由脚本动态启用，还要确保相应 `shader_feature` 变体没有被构建剥离。

### 5.3 问题 5：`_LightDirection` 从哪里来，做什么？

```hlsl
float3 _LightDirection;
```

它不是材质属性，所以不需要写在 `Properties` 中。URP 在绘制阴影贴图之前，会从 C# 侧把它设置为全局 Shader 变量。

在 URP 14.0.12 中，调用链可以在包源码中核对：

```text
ShadowUtils.SetupShadowCasterConstantBuffer(...)
    -> 根据正在投影的灯光计算 lightDirection
    -> CommandBuffer.SetGlobalVector(_LightDirection, ...)
    -> 执行物体的 ShadowCaster Pass
```

对方向光来说，每个顶点到光源的方向相同，所以一个全局 `_LightDirection` 就够了。这里的方向遵循前向渲染笔记中的约定：

```text
_LightDirection = L = 表面 -> 光源
```

它在当前 Pass 中不用于计算颜色，而是传给 `ApplyShadowBias`，帮助决定顶点应该向哪里做阴影偏移。

点光源和聚光灯不同：表面上不同位置指向灯的位置方向不同。URP 的标准 `ShadowCasterPass.hlsl` 会额外接收 `_LightPosition`，按顶点计算：

```hlsl
normalize(_LightPosition - positionWS)
```

当前教学 Shader 只有 `_LightDirection` 路径，因此它主要覆盖方向光投影；不能因为 Pass 名叫 `ShadowCaster` 就认为点光、聚光的标准路径也已经自动完成。

### 5.4 问题 6：`ApplyShadowBias` 是什么意思？

```hlsl
float3 biasedWorldPos = ApplyShadowBias(worldPos, worldNormal, _LightDirection);
```

阴影贴图精度有限。一个表面既写入阴影贴图，又在相机绘制时拿自己的深度与阴影贴图比较，微小的量化和插值误差可能让它误以为“前面还有遮挡物”，出现条纹或黑点，这叫 shadow acne（阴影痤疮/自阴影伪影）。

`ApplyShadowBias` 在写入阴影贴图之前稍微移动投影位置，让深度比较留出容错空间。URP 14 的核心实现可简化为：

```hlsl
float invNdotL = 1.0 - saturate(dot(lightDirection, normalWS));
float normalScale = invNdotL * _ShadowBias.y;

positionWS += lightDirection * _ShadowBias.x;
positionWS += normalWS * normalScale;
```

两部分分别是：

- 深度偏移：沿光线相关方向移动，由 `_ShadowBias.x` 控制。
- 法线偏移：沿表面法线移动，由 `_ShadowBias.y` 控制；表面越接近掠射角，`1 - N·L` 越大，偏移越强。

URP 的 C# 代码会根据灯光的 Bias、Normal Bias、阴影分辨率和阴影视锥大小计算 `_ShadowBias`，当前版本上传的是带负号的值。因此结合这里“表面到光源”的方向约定，实际位置会向远离光源和法线内侧的方向偏移。

```text
L = 表面 -> 光源
_ShadowBias.x < 0  =>  L * 负数 = -L，向远离光源方向偏移
_ShadowBias.y < 0  =>  N * 负数 = -N，向表面法线内侧偏移
```

Bias 不是越大越好：

- 太小：仍会出现自阴影条纹。
- 太大：阴影与物体底部脱离，出现 Peter Panning（阴影漂浮）。

所以 `ApplyShadowBias` 不是制造阴影，而是修正阴影贴图深度比较的数值误差。

### 5.5 为什么还要处理 `UNITY_REVERSED_Z`

```hlsl
#if UNITY_REVERSED_Z
    o.pos.z = min(o.pos.z, o.pos.w * UNITY_NEAR_CLIP_VALUE);
#else
    o.pos.z = max(o.pos.z, o.pos.w * UNITY_NEAR_CLIP_VALUE);
#endif
```

应用 Bias 后，顶点可能被推过灯光相机的近裁剪面。这段代码把裁剪空间深度限制回近裁剪面允许的范围。

`UNITY_REVERSED_Z` 表示当前图形 API 是否使用反向 Z 深度，不应简单理解成“是不是 DirectX”。不同深度方向下，限制近裁剪面的 `min`/`max` 方向相反。

### 5.6 为什么阴影 Pass 的片元函数只 `return 0`

```hlsl
half4 frag(v2f i) : SV_Target
{
    return 0;
}
```

阴影贴图阶段关心的是深度，不是材质最终颜色；深度由光栅化后的顶点位置和深度测试写入。因此返回黑色并不是“阴影颜色是黑色”，而是颜色输出通常不会被使用。

仍然保留片元着色器，是因为透明度裁剪、LOD 淡出等功能需要在逐片元阶段决定是否丢弃这个片元。

## 6. 问题 7：为什么有两个 Pass？两个都有效还是取其一？

两个都有效，但由 URP 在不同渲染阶段按 `LightMode` 分别调用。

| Pass | 谁来调用 | 观察位置 | 写入目标 | 作用 |
| --- | --- | --- | --- | --- |
| `ShadowCaster` | URP 阴影渲染阶段 | 灯光 | 阴影贴图深度 | 让物体投射阴影 |
| `UniversalForward` | URP 相机前向渲染阶段 | 相机 | 相机颜色/深度目标 | 计算物体可见颜色并接收阴影 |

在启用实时阴影且物体允许投影时，一帧中常见顺序是：

1. URP 用物体的 `ShadowCaster` Pass 更新阴影贴图。
2. URP 用物体的 `UniversalForward` Pass 从相机视角绘制物体。
3. 前向 Pass 查询第 1 步的阴影贴图，得到 `shadowAttenuation`。

不过它们可以独立缺席：

- 没有 `ShadowCaster` Pass：物体仍可显示，也可以接收别人的阴影，但自己通常不能写入实时阴影贴图。
- 有 `ShadowCaster`、没有可用的相机颜色 Pass：物体可能投影，却无法按预期显示。
- 关闭灯光阴影或物体的 Cast Shadows：该物体的 `ShadowCaster` Pass 不会用于对应阴影图。
- 前向 Pass 不采样或不乘阴影衰减：物体可以投影，却不会在自身表面显示接收到的实时阴影。

“投射阴影”和“接收阴影”是两件事：前者由 `ShadowCaster` 提供深度，后者由可见颜色 Pass 查询并应用深度比较结果。

## 7. 从上到下快速阅读整份 Shader

| 代码位置 | 一句话含义 |
| --- | --- |
| `Properties` | 定义材质可保存和可编辑的数据 |
| `SubShader Tags` | 声明当前实现面向 URP 和不透明物体 |
| `HLSLINCLUDE` | 共享两个 Pass 都要看到的类型、函数和 CBUFFER |
| `UnityPerMaterial` | 给 GPU 组织每个材质的漫反射色、高光色和光泽度 |
| 第一个 `Pass` / `UniversalForward` | 从相机看物体，算最终颜色 |
| 前向 Pass 的 pragmas | 为 URP 的灯光/阴影设置准备可选择的编译变体 |
| 前向 `vert` | 准备裁剪位置、世界位置、世界法线 |
| `TransformWorldToShadowCoord` | 把当前世界点变到主光阴影贴图坐标 |
| `GetMainLight(shadowCoord)` | 得到完整主光数据，并额外查询该点的阴影衰减 |
| `diffuse/specular` | 用光方向和颜色计算直接光 |
| `ambient` | 简化的球谐环境光，不属于主光直接光 |
| `distanceAttenuation * shadowAttenuation` | 把范围/距离与遮挡共同作用到直接光 |
| 附加光循环 | 累加点光/聚光等附加光；当前不含附加光阴影 |
| 第二个 `Pass` / `ShadowCaster` | 从灯光看物体，把深度写入阴影贴图 |
| `_LightDirection` | URP 在阴影绘制前设置的全局灯光几何参数 |
| `ApplyShadowBias` | 写阴影贴图前偏移顶点，减轻自阴影误差 |
| `UNITY_REVERSED_Z` 分支 | 防止偏移后越过近裁剪面，并兼容不同深度方向 |
| 阴影 `frag` 返回 `0` | 颜色无关紧要；片元阶段主要预留裁剪能力 |

## 8. 当前 Shader 已修正与仍保留的限制

已修正：

- 把 `_MAIN_LIGHT_SHADOWS_CACADE` 改为 `_MAIN_LIGHT_SHADOWS_CASCADE`。
- 把普通、级联和屏幕空间主光阴影放进同一组互斥变体，并修正对 URP 14 屏幕坐标分支的说明。
- 删除当前手写附加光循环完全没有读取的 `_ADDITIONAL_LIGHTS_VERTEX/_ADDITIONAL_LIGHTS` 无效变体组。
- 把 `mainLight.shadowAttenuation` 乘进直接光，真正使用已经查询到的主光阴影。
- 在片元阶段重新归一化插值法线。
- 统一使用 `SV_Target`，并补充逐段注释。
- 把误写为文件路径的 `FallBack` 改成 URP 实际 Shader 名称 `Hidden/Universal Render Pipeline/FallbackError`。

刻意保留、只做说明的限制：

- `_ALPHATEST_ON` 只有变体声明，没有纹理采样和 `clip()`，当前不产生透明裁剪。
- 附加光只计算颜色与距离/聚光衰减，不接收附加光实时阴影。
- 附加光循环始终写在片元阶段，没有实现 URP 的 `_ADDITIONAL_LIGHTS_VERTEX` 路径，也不兼容 Forward+。
- 当前自写 `ShadowCaster` 只使用 `_LightDirection`，没有实现 URP 标准点光/聚光的 `_LightPosition` 路径。
- 环境光只取球谐常数项，是教学简化；更完整的 URP 光照通常会按法线采样球谐或使用 GI 接口。

这些限制不妨碍理解“方向光主阴影”的核心流程，但扩展到镂空材质、附加光阴影或完整 URP Lit 行为时必须补齐。

## 9. 官方资料与本地源码核对位置

官方文档：

- [URP 14.0：在自定义 Shader 中使用阴影](https://docs.unity3d.com/Packages/com.unity.render-pipelines.universal@14.0/manual/use-built-in-shader-methods-shadows.html)
- [URP 14.0：在自定义 Shader 中使用光照](https://docs.unity3d.com/Packages/com.unity.render-pipelines.universal@14.0/manual/use-built-in-shader-methods-lighting.html)
- [Unity 2022.3：Shader 中的条件、`multi_compile` 与 `shader_feature`](https://docs.unity3d.com/cn/2022.3/Manual/shader-conditionals.html)
- [Unity 2022.3：Shader 语义与 `SV_Target`](https://docs.unity3d.com/cn/2022.3/Manual/SL-ShaderSemantics.html)
- [Microsoft：HLSL 系统值语义](https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/dx-graphics-hlsl-semantics)

项目中已安装的 URP 14.0.12 包源码：

- [`GetMainLight` 与 `Light` 结构体](../Library/PackageCache/com.unity.render-pipelines.universal@14.0.12/ShaderLibrary/RealtimeLights.hlsl)
- [`ApplyShadowBias`](../Library/PackageCache/com.unity.render-pipelines.universal@14.0.12/ShaderLibrary/Shadows.hlsl)
- [URP 标准 `ShadowCaster` 实现](../Library/PackageCache/com.unity.render-pipelines.universal@14.0.12/Shaders/ShadowCasterPass.hlsl)
- [C# 设置 `_LightDirection`、`_LightPosition` 与 `_ShadowBias`](../Library/PackageCache/com.unity.render-pipelines.universal@14.0.12/Runtime/ShadowUtils.cs)
