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

## 为什么会投影到地面，本章球体却未必接收阴影？

这两份 Shader 都借用了 Lit 的 `ShadowCaster`。但在当前前向 Pass 中，`ambient + lerp(...) * atten` 的 `atten` 只取了 `mainLight.distanceAttenuation`。本章在 URP 14.0.12 的非 Forward+ 分支中，这个主光字段来自 `unity_LightData.z`，表示主光的剔除结果（`0` 或 `1`）；它没有包含阴影贴图的遮挡。

若要给本章 Shader 接上主光实时阴影，需要同时检查两个环节：Pass 是否编译并选中对应的主光阴影变体，以及希望受阴影影响的颜色项是否使用了 `mainLight.shadowAttenuation`。参考[第 9 章的完整阴影路径](Chapter09-Shadow-QA.md#35-问题-2getmainlightshadowcoord-与不传参数有什么区别)。声明 Pass 与备选 Shader 名的区别见 [`UsePass` 与 `FallBack`](Unity-Shader-Practice.md#usepass-fallback)。
