# Chapter 10：环境反射与折射

对应 [Reflection Shader](../Assets/Shaders/Chapter10/Chapter10-Reflection.shader)、[Refraction Shader](../Assets/Shaders/Chapter10/Chapter10-Refraction.shader) 和 [Glass Refraction Shader](../Assets/Shaders/Chapter10/Chapter10-GlassRefraction.shader)。以下用本章代码说明方向、取样和混色怎样接起来。

## `TEXTURECUBE`、`SAMPLER` 和 `SAMPLE_TEXTURECUBE` 各做什么？

反射 Shader 先声明贴图对象和采样器，再用反射方向取样：

```hlsl
TEXTURECUBE(_Cubemap);
SAMPLER(sampler_Cubemap);
// 在片元阶段：
half3 reflection = SAMPLE_TEXTURECUBE(_Cubemap, sampler_Cubemap, i.worldRefl).rgb * _ReflectColor.rgb;
```

`_Cubemap` 指定读哪张环境贴图，`sampler_Cubemap` 指定采样规则，例如如何过滤相邻纹素。第三个参数 `i.worldRefl` 是世界空间方向，决定去 Cubemap 的哪个位置取颜色：例如 `(1, 0, 0)` 指向 `+X` 面中央。这个方向在顶点阶段由 `reflect` 算出，再插值到片元。传给 `reflect` 的是朝表面走的入射方向，所以要给指向相机的 `worldViewDir` 取负。

同一 Pass 中的 `saturate(dot(i.worldNormal, lightDir))` 算的是漫反射的光照系数。见 [`saturate` 的通用笔记](Unity-Shader-Practice.md#saturate)。

## `_RefractRatio` 和 `_RefractAmount` 为什么看起来相似？

两者分别在**取颜色之前**和**取颜色之后**生效：

```hlsl
o.worldRefr = refract(-normalize(o.worldViewDir), normalize(o.worldNormal), _RefractRatio);
// 用 worldRefr 从 Cubemap 取到 refraction 之后：
half3 color = ambient + lerp(diffuse, refraction, _RefractAmount) * atten;
```

- **Ratio 改图案位置。** 它是入射介质与折射介质折射率之比，用来算取样方向。值为 `1` 时方向不偏折。把 Amount 固定在 `1`，将 Ratio 从 `1` 调到 `0.3`，观察球侧面一条明显的纹理边界。球中央接近垂直入射，变化通常较小。
- **Amount 改图案显眼程度。** 固定 Ratio，再把 Amount 从 `1` 调到 `0`，同一条边界会淡出。Amount 到 `0` 后，混合项只剩漫反射，调整 Ratio 也看不出变化；外面的 `ambient` 仍然会加上去。

这里看到的是沿折射方向从**环境 Cubemap** 取来的颜色。Shader 没有读取球后当前相机渲染的物体。

<a id="chapter10-fresnel"></a>
## `_FresnelScale` 控制什么？视线贴着表面时会看见什么？

[本章 Fresnel Shader](../Assets/Shaders/Chapter10/Chapter10-Fresnel.shader#L66) 将从表面点指向相机的方向归一化，然后和插值后的世界法线做点积。算出的权重用来混合漫反射和从 Cubemap 取到的环境倒影：

```hlsl
half3 viewDir = normalize(i.worldViewDir);
half fresnel = _FresnelScale + (1 - _FresnelScale) * pow(1 - dot(viewDir, i.worldNormal), 5);
// ……
half3 color = ambient + lerp(diffuse, reflection, saturate(fresnel)) * atten;
```

角度取决于**该点的视线和物体表面**。正看时，视线沿着法线，点积接近 `1`，所以 `_FresnelScale` 是正面的基础反射权重；贴着表面看时，视线垂直于法线，点积接近 `0`，反射权重趋近 `1`。如果物体表面平行于相机的成像平面，画面中央的视线反而近似垂直撞上物体表面，接近正看。5 次方和 `0.04` 的出处见[菲涅尔效应与 Schlick 近似](Graphics-Fundamentals.md#fresnel-schlick)。

掠射时，颜色趋近 `ambient + reflection * atten`。这让环境倒影的权重变大，明暗取决于反射方向对应的 Cubemap 颜色。球面上这种角度主要出现在轮廓附近；同一材质用在 `Plane` 上，降低相机、从正面贴着平面看时，大片可见区域都可能以倒影为主。再贴近共面时，平面也会因透视投影变薄。

[Shader 声明的默认值](../Assets/Shaders/Chapter10/Chapter10-Fresnel.shader#L5) 是 `1`，取这个值时整个 `lerp` 恒选 `reflection`，反射权重不再随角度变化。对照时可固定 Cubemap，把 [FresnelMat 材质](../Assets/Materials/Chapter10/FresnelMat.mat) 的 **Fresnel Scale** 在 `0.04` 和 `1` 之间切换，看球的正面和轮廓，或将相机从俯视移到接近 `Plane` 的高度。

当前 Shader 只归一化了 `viewDir`。球面上的 `i.worldNormal` 是[插值后的法线](Graphics-Fundamentals.md#interpolated-normal)，长度不一定为 `1`，点积会掺入长度的影响。计算时可先在片元用 `N = normalize(i.worldNormal)`，再用 `saturate(dot(viewDir, N))` 作为角度项；漫反射和 `SampleSH` 也可共用这个单位法线。`Plane` 各顶点法线相同，通常不受插值缩短的影响。

## 为什么会投影到地面，本章球体却未必接收阴影？

本章的 Reflection、Refraction 和 Fresnel Shader 都借用了 Lit 的 `ShadowCaster`。但在当前前向 Pass 中，`ambient + lerp(...) * atten` 的 `atten` 只取了 `mainLight.distanceAttenuation`。本章在 URP 14.0.12 的非 Forward+ 分支中，这个主光字段来自 `unity_LightData.z`，表示主光的剔除结果（`0` 或 `1`）；它没有包含阴影贴图的遮挡。

若要给本章 Shader 接上主光实时阴影，需要同时检查两个环节：Pass 是否编译并选中对应的主光阴影变体，以及希望受阴影影响的颜色项是否使用了 `mainLight.shadowAttenuation`。参考[第 9 章的完整阴影路径](Chapter09-Shadow-QA.md#35-问题-2getmainlightshadowcoord-与不传参数有什么区别)。声明 Pass 与备选 Shader 名的区别见 [`UsePass` 与 `FallBack`](Unity-Shader-Practice.md#usepass-fallback)。

## 镜子 Shader 的 `2D` 就是摄像机输出吗？

[镜子 Shader](../Assets/Shaders/Chapter10/Chapter10-Mirror.shader) 中的 `_MainTex("Main Tex", 2D) = "white"{}` 声明了一个二维纹理槽；`Main Tex` 是 Inspector 显示名，`_MainTex` 是代码读取的属性名。纹理的来源由材质绑定决定，同一个槽也能放普通二维图片。

在[镜子场景](../Assets/Scenes/Chapter10/Scene_10_2_1镜子效果.unity)，名为 `Camera` 的相机把 [`MirrorTexture`](../Assets/Textures/Chapter10/MirrorTexture.renderTexture) 设为 [`targetTexture`](https://docs.unity3d.com/2022.3/Documentation/ScriptReference/Camera-targetTexture.html)，渲染时往里面写画面。镜面使用的 [`MirrorMat`](../Assets/Materials/Chapter10/MirrorMat.mat) 又把同一个资源绑定给 `_MainTex`。Shader 把镜面网格的 UV 水平翻转，再用 `tex2D(_MainTex, i.uv)` 读相应颜色。这个场景的 `Main Camera` 没有指定输出纹理，负责把含镜面的场景画到屏幕。

<a id="glass-refraction"></a>
## 玻璃怎样同时显示被扭曲的背景和环境倒影？

[玻璃 Shader](../Assets/Shaders/Chapter10/Chapter10-GlassRefraction.shader#L60) 给每个片元合成两份颜色：从先前拍下的背景画面偏移取样，形成折射观感；用表面法线算反射方向，再从 Cubemap 取环境倒影。两条路径共用法线贴图，但用它的方式不同。

先只看屏幕上的一个玻璃像素：假设背景图同一格是红色，右边一格是蓝色。如果这处玻璃的偏移恰好向右一格，Shader 就去右边读蓝色，把它写回原来那个玻璃像素。玻璃网格没动，背景图也没改，每个玻璃像素只是去不同的地方取色。一条红蓝分界线如果每行都偏相同距离，只会整体平移；法线贴图让每行的偏移可以不一样，直线才会弯。倒影是另一份颜色：从这个像素的表面朝向算出反射方向，到环境图里取色，再与刚读到的蓝色混合。

因此有两组容易混淆的 UV：`i.uv.zw` 来自玻璃网格的 UV，回答「这是玻璃贴图上的哪个位置，箭头朝哪边」；`screenUV` 来自片元的屏幕位置，回答「这个玻璃像素在背景图上本来该读哪一格」。前者取出一个方向，后者加上偏移再取出颜色。

1. **确定玻璃画在哪，以及该去背景图的哪一格。** 顶点输出的 `o.pos = posInputs.positionCS` 是[齐次裁剪坐标](Graphics-Fundamentals.md#homogeneous-clip-space)，交给 GPU 用于裁剪和光栅化。到片元时，同一个 `SV_POSITION` 语义的 `i.pos.xy` 已是像素位置；`GetNormalizedScreenSpaceUV(i.pos)` 把它换成未偏移的背景 UV。不再需要以前用 `ComputeScreenPos` 传递的额外坐标和手动除以 `w`。
2. **让背景图案看起来被玻璃扭弯。** `UnpackNormal` 从 `_BumpMap` 解出切线空间法线。`bump.xy * _Distortion` 给出以渲染像素计的偏移，除以 `GetScaledScreenParams().xy` 换算成 UV，然后用 `SampleSceneColor` 读相机背景。比如渲染宽度是 960，横向偏 12 个像素就是加上 `12 / 960`。玻璃片元的位置不变，只改变读取位置。这是屏幕取样近似；现在的偏移不再乘旧版的投影深度因子 `scrPos.z / scrPos.w`。
3. **让倒影随局部法线偏转。** 顶点调用 `GetVertexNormalInputs` 获取世界空间的 `T、B、N`。URP 14.0.12 以 `cross(N, T) * tangentOS.w * GetOddNegativeScale()` 得到 `B`，乘号后的因素用于保留切线基底的朝向，处理镜像 UV 和奇数个负缩放。Shader 把[切线转世界矩阵](Graphics-Fundamentals.md#tangent-frame)的三行放在 `TtoW0/1/2.xyz`，用每行与原切线空间法线的点积得到世界法线的一个分量，最后归一化。三个 `.w` 只是顺手装入的世界位置 `x/y/z`，用于求从片元指向相机的方向 `V`；它们不参与法线变换。用 `reflect(-V, N_ws)` 得到朝向环境的方向，采样 `_Cubemap`，再乘 `_MainTex.rgb` 给倒影上色。
4. **把两份 RGB 合成。** `_RefractAmount = 0` 只显示倒影，`1` 只显示背景取样，中间值线性混合。本例没有按视角算菲涅尔权重。片元返回 `alpha = 1`，透过玻璃的观感来自手动读入背景颜色。透明队列用于安排绘制时间，不会自动抓取背景。

### 迁移到 URP 时，玻璃为什么一度看不到里面的球？

迁移期间，原来的 `GrabPass` 已注释，Shader 还在读默认是白图的 `_RefractionTex`，[玻璃材质](../Assets/Materials/Chapter10/GlassRefractionMat.mat) 也没有给这个槽绑定相机画面。因此折射分支在纯白背景上移动取样坐标，读不出球或墙的轮廓。能看到 Cubemap 倒影，只能说明反射分支有数据。

项目已在主相机的 Rendering → Opaque Texture 设为 On，并让 [Shader](../Assets/Shaders/Chapter10/Chapter10-GlassRefraction.shader#L85) 用 `SampleSceneColor` 读取 `_CameraOpaqueTexture`。这两处分别负责生成和读取画面；只打开相机开关不会填充旧的 `_RefractionTex` 槽。[Opaque Texture](https://docs.unity3d.com/Packages/com.unity.render-pipelines.universal@14.0/manual/universalrp-asset.html#rendering) 是绘制透明物体前的快照，所以本场景的不透明球会被拍进去。在 Game 窗口验证；Scene 窗口使用编辑器相机，它在 URP 14.0.12 中读取 [URP-HighFidelity](../Assets/Settings/URP-HighFidelity.asset#L23) 的全局选项。

验证顺序：先在 Frame Debugger 里确认玻璃前有 `CopyColor`，再设 Amount = `1`、Distortion = `0`，看没扭曲时能否透过立方体看见球；能看到后再加 Distortion。最后设 Amount = `0`，单独检查 Cubemap 倒影。这个顺序先验证纹理来源，再验证 UV 偏移。
