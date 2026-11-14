# Chapter9

### 1.2 第一次绘制：3D 三角形怎样变成一张二维深度图

1. **确定灯光视角。** 方向光本身只需要方向；URP 为阴影绘制构造一个覆盖所需区域的灯光视图矩阵 `V_light` 和正交投影矩阵 `P_light`。`V_light` 把世界位置换成以光线为参考的坐标，`P_light` 把选定的覆盖范围映射到裁剪空间。
2. **把投影物体的网格画到深度纹理上。** `ShadowCaster` 先把模型顶点变到世界空间，应用阴影 Bias，再用 `P_light × V_light` 变到裁剪空间。GPU 裁剪并做齐次除法（`xyz / w`；本例正交投影的 `w = 1`），再把平面坐标映射到深度纹理的视口。光栅化时，GPU 判断投影后的三角形覆盖了哪些纹素采样位置，并为这些位置算出投影深度。这样，三维位置的前两个投影分量决定「写哪格」，深度分量决定「用什么数去做深度测试」。一个三角形可以覆盖许多格。
3. **每格只留下最近的一层。** 每个参与投影的片元都和该格已有的深度做深度测试，测试通过才更新。以图中的普通 Z 为例，`[1,2]` 先清成远端值 `1.00`，地板若先画进去会写 `0.80`，方块顶面再以 `0.30` 覆盖它。若先画方块，地板就通不过测试，结果仍是 `0.30`。没有投影片元覆盖的格保留清除值。

为什么 `TransformWorldToHClip` 在这里是从灯光看？URP 的 `RenderShadowSlice` 在 `DrawShadows` 之前执行 `cmd.SetViewProjectionMatrices(view, proj)`，把当前绘制使用的视图、投影矩阵切到灯光视角。于是 本章 `ShadowCaster` 顶点函数 里的同一个函数用的就是灯光矩阵：

float3 biasedWorldPos = ApplyShadowBias(worldPos, worldNormal, _LightDirection);
o.pos = TransformWorldToHClip(biasedWorldPos);

**实际数据结构：** 主光的 `_MainLightShadowmapTexture` 是一张 GPU 上的 `W × H` **二维深度渲染纹理**。可以把它想成 `depth[row][column]`：每个纹素逻辑上只有一个经过量化的投影深度。图里的 `0.30` 不是 RGB、阴影浓度、物体 ID 或世界坐标，也不是「灯到 A 的 0.30 米」。主光 Pass 请求 16 位深度；`ShadowUtils` 通过 Unity 选择深度格式，颜色格式为 `None`。调试器把它显示成灰度图，只是为了让人看见深度数值。

### 1.3 第二次绘制：当前表面点怎样得到 `(u, v, z)`

游戏相机绘制地板时，相机投影决定三角形覆盖哪些屏幕像素。前向顶点函数把每个顶点的**世界位置**写进 `o.worldPos`；GPU 在相机画面里光栅化三角形时，对这些世界位置做透视校正插值，因此 `frag` 收到的 `i.worldPos` 就是当前片元对应的表面位置。接着 Shader 用**灯光的投影**查这个点是否被挡住。

// Chapter9-Shadow.shader：前向 Pass 的 vert 中
o.worldPos = positionInputs.positionWS;
​
// 同一 Pass 的 frag 中
float4 shadowCoord = TransformWorldToShadowCoord(i.worldPos);
Light mainLight = GetMainLight(shadowCoord);

在普通或级联方向光阴影路径中，`TransformWorldToShadowCoord` 把世界位置乘以 `_MainLightWorldToShadow[cascadeIndex]`，返回 `(u, v, z, 0)`。这个矩阵使用**写图时同一份灯光视图和投影**，还包含纹理坐标所需的缩放和偏移（以及相应的深度方向处理）。写图时，GPU 把投影位置映射到视口内的纹素；读图时，矩阵把投影位置映射到同一区域的归一化 UV。**`u、v` 指向第一次写入的纹素位置；`z` 是当前表面点的参考深度，与纹理中保存的深度使用同一套编码。** 返回向量里的第四个分量 `0` 只是占位，并非第 1.2 节的齐次 `w`；这条方向光路径不再做齐次除法。







这短短几句话信息量很大和很复杂，我线代有点弱。我希望可交互的可视化+文字讲解那种，具体是说明V_light、P_light这些组合起来的作用，是怎么一步步转换的，这个能教会我这个懂一点线代和一点图形学能够了解其原理！





不，我说的可交互式，是threeD js +html！



怎么放临时文件夹下，当然是当前项目的docs下





怎么说的？还是不基础，跳变太快了，我无法理解一个一个步骤的转换过程！



比如：**V · 换尺子的原点和方向。** 灯光原点是 `O = (0, 5.8, 4)`。先算 `A − O = (2.6, −1.8, −2)`，再分别与灯光的右轴 `(0.8, 0.6, 0)`、上轴 `(0, 0, −1)`、后轴 `(−0.6, 0.8, 0)` 点积，得到 `(1, 2, −3)`。灯光上轴在世界里指向 −Z，所以换轴后地板可能看起来像侧立着。  



各个向量在坐标系是哪一个？点积后为什么换轴了？这些过程我都希望一步一步图示和解答，而不是跳变太快了。！





E:\workspace\Study\0.Unity\LearnShader\UnityURPShaderLearn\Docs\Chapter09-Shadow-QA.md
这里为什么没说明 p、v 矩阵的来源，也没有代值？