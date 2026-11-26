# Chapter 11 · 序列帧动画

用「下一步」跟着同一个点完成七步计算。 [离线逐步教程（HTML）](Chapter11-ImageSequenceAnimation.html)

## 时间怎么变成图集上的一个取样位置？

场景里的 Quad 使用 ImageSequenceAnimationMat。材质把爆炸的 64 张小图放在同一张 `boom.png` 里，每行 8 格、共 8 行，速度设置为每秒 40 帧。主贴图的 Tiling 为 `(1, 1)`、Offset 为 `(0, 0)`，所以 `i.uv` 沿用 Quad 上从 0 到 1 的坐标。U 从左往右增加，V 从下往上增加。 [序列帧材质](../Assets/Materials/Chapter11/ImageSequenceAnimationMat.mat) · [boom.png 图集](../Assets/Textures/Chapter11/boom.png)

### 怎么从帧号得到行列？

```hlsl
float time = floor(_Time.y * _Speed);
float row = floor(time / _HorizontalAmount);
float column = time - row * _HorizontalAmount;
```

假设 `_Time.y = 0.26` 秒，乘每秒 40 帧得到 `10.4`。`floor` 向下取整，所以变量 `time` 存的是从 0 开始数的帧号 `10`。每 8 帧分成一组，`10` 前面有一整组，再在下一组向右数两格。`row = floor(10 / 8) = 1`，`column = 10 − 1 × 8 = 2`。

```text
帧号分组       列 0   列 1   列 2   …   列 7
row = 0          0      1      2    …      7
row = 1          8      9    [10]   …     15
```

### 行列怎么和片元原本的 UV 合在一起？

```hlsl
half2 uv = i.uv + half2(column, -row);
uv.x /= _HorizontalAmount;
uv.y /= _VerticalAmount;
```

1. **先以一格的宽、高为单位。** 假定当前片元的 `i.uv = (0.25, 0.5)`，它在平面上从左边走四分之一、从底边走一半。把这组比例当成在一个格子里的位置。
2. **把整格移到选中的位置。** 加上 `(2, −1)`，相当于向右挪两格、向下挪一格。以图集左下角为原点，U 往右、V 往上，格中同一点变成 `(2.25, −0.5)`，单位仍是格。
3. **换成整张图的 UV。** 整张图的宽和高分别是 8 格，所以横纵各除以 8，交给采样器的是 `(0.28125, −0.0625)`。这个偏移和缩放会对每个片元各算一次，整个 Quad 由此在同一格内取色。 [Shader 的帧号与 UV 计算](../Assets/Shaders/Chapter11/Chapter11-ImageSequenceAnimation.shader#L56)

### V 是负数时为什么还能读到一格？

以 `Repeat` 采样为例，图集沿纵向重复。低于原图底边一点，等价于采样原图靠顶边的同一位置。`−0.0625 + 1 = 0.9375`，所以实际取到的是图集顶排第 3 格里的点，依旧在那格的四分之一宽、半高处。`row = 0` 读取底排，`row = 1` 越过底边后读取顶排，后续再向下移。行组号每增长 8，采样 V 少 1，`Repeat` 下就回到同一排。若使用 `Clamp`，负 V 会被限制在底边。 [Unity Repeat 采样规则](https://docs.unity3d.com/2022.3/Documentation/ScriptReference/TextureWrapMode.Repeat.html)
