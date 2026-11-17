# Chapter 10：环境反射与折射

对应 [Reflection Shader](../Assets/Shaders/Chapter10/Chapter10-Reflection.shader) 和 [Refraction Shader](../Assets/Shaders/Chapter10/Chapter10-Refraction.shader)。以下用本章代码说明方向、取样和混色怎样接起来。

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
