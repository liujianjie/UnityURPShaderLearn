
Shader "Unity Shaders Book/Chapter 9/Shadow" {
    Properties
    {
		// Properties 负责在材质 Inspector 中显示并保存数值；
		// 同名 HLSL 变量还要在下面的 UnityPerMaterial CBUFFER 中声明。
		_Diffuse ("Diffuse", Color) = (1, 1, 1, 1)
		_Specular ("Specular", Color) = (1, 1, 1, 1)
		_Gloss ("Gloss", Range(8.0, 256)) = 20

		// Toggle 会在勾选时给材质启用自定义关键字 _AdditionalLights。
		// 注意大小写：它不是 URP 自己的 _ADDITIONAL_LIGHTS 关键字。
		[Toggle(_AdditionalLights)]
        _AddLights ("AddLights", Float) = 1
    }
    SubShader
    {
		Tags{
			// 只让 URP 使用这个 SubShader；Opaque 表示按不透明物体处理。
			"RenderPipeline" = "UniversalPipeline"
			"RenderType" = "Opaque"
        }

		// HLSLINCLUDE 中的内容会被下面两个 Pass 共同看见，避免重复声明结构体和材质参数。
		HLSLINCLUDE
			#include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
			// Lighting.hlsl 还会间接引入实时光源和阴影相关函数，例如 GetMainLight。
			#include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

			// URP 的 SRP Batcher 要求材质常量放在同一个 UnityPerMaterial CBUFFER 中，
			// 并且所有 Pass 看到的布局应保持一致。
			CBUFFER_START(UnityPerMaterial)
				half4 _Diffuse;
				half4 _Specular;
				float _Gloss;
			CBUFFER_END

			// a2v：应用程序/网格传给顶点着色器的数据，仍处于对象空间（OS）。
            struct a2v{
                float4 vertex : POSITION;
                float3 normal : NORMAL;
                float4 tangent : TANGENT;
            };

			// v2f：顶点着色器插值后传给片元着色器的数据。
            struct v2f{
                float4 pos : SV_POSITION;
                float3 worldNormal : TEXCOORD0;
                float3 worldPos : TEXCOORD1;
            };
        ENDHLSL

		// 第一个 Pass：从相机视角绘制物体，并计算最终可见颜色。
        Pass{
			// URP 在前向相机渲染阶段查找这个 LightMode。
            Tags { "LightMode"="UniversalForward" }

            HLSLPROGRAM
			// 材质级自定义开关：决定是否执行下面手写的附加光循环。
			#pragma shader_feature _AdditionalLights

			// URP 运行时根据主光阴影模式选择其一：关闭、普通、级联或屏幕空间阴影。
			// 同一行表示这些选项互斥；原来的 _MAIN_LIGHT_SHADOWS_CACADE 是拼写错误。
			// URP 14 的 TransformWorldToShadowCoord 会在 SCREEN 变体内自行生成屏幕坐标。
			#pragma multi_compile _ _MAIN_LIGHT_SHADOWS _MAIN_LIGHT_SHADOWS_CASCADE _MAIN_LIGHT_SHADOWS_SCREEN

			// 让阴影采样代码同时拥有硬阴影与软阴影变体。
			#pragma multi_compile _ _SHADOWS_SOFT

            #pragma vertex vert
            #pragma fragment frag

            v2f vert(a2v v)
            {
                v2f o;
				// Built-in Render Pipeline 的近似旧写法（这里只作为迁移对照）：
				//  o.pos = UnityObjectToClipPos(v.vertex);     // 顶点位置
				//  o.worldNormal = UnityObjectToWorldNormal(v.normal); // 世界空间法线
				//  o.worldPos = mul(unity_ObjectToWorld, v.vertex).xyz;    // 世界空间位置
				//	TRANSFER_SHADOW(o);// 计算阴影纹理坐标

				// 一次得到该顶点在多个坐标空间中的位置。
				VertexPositionInputs positionInputs = GetVertexPositionInputs(v.vertex.xyz);
				o.pos = positionInputs.positionCS;		// CS = Homogeneous Clip Space，供光栅化器使用
				o.worldPos = positionInputs.positionWS;	// WS = World Space，供光照和阴影查询使用

				// 将对象空间法线/切线变换到世界空间。当前光照只使用 normalWS。
				VertexNormalInputs normalInputs = GetVertexNormalInputs(v.normal, v.tangent);
				o.worldNormal = NormalizeNormalPerVertex(normalInputs.normalWS);
				return o;
            }

			half4 frag(v2f i) : SV_Target
			{
				// 把当前表面点的世界坐标变换到主光阴影贴图空间，供阴影贴图比较使用。
				float4 shadowCoord = TransformWorldToShadowCoord(i.worldPos);

				// 无参 GetMainLight() 只填充方向、颜色、距离衰减等基础光源数据，
				// 这个重载先取得同一份数据，再用 shadowCoord 填充 shadowAttenuation。
				// 它不是 TRANSFER_SHADOW：后者是 Built-in 管线中“生成并传递阴影坐标”的宏。
				Light mainLight = GetMainLight(shadowCoord);

				// 插值后的法线长度可能不再恰好为 1，因此在逐像素计算前再归一化。
				half3 worldNormal = NormalizeNormalPerPixel(i.worldNormal);
				half3 worldLightDir = normalize(mainLight.direction);              // L：表面 -> 光源
                half3 viewDir = normalize(_WorldSpaceCameraPos.xyz - i.worldPos); // V：表面 -> 相机
				half3 halfDir = normalize(worldLightDir + viewDir);                 // H = normalize(L + V)

                half3 diffuse = mainLight.color * _Diffuse.rgb
					* max(0, dot(worldNormal, worldLightDir));
				half3 specular = mainLight.color * _Specular.rgb
					* pow(max(0, dot(worldNormal, halfDir)), _Gloss);

				// 这里只取球谐环境光的常数项，是简化写法；环境光不是 mainLight 的字段。
				// 环境光通常不乘实时阴影，否则阴影区会失去间接光而过黑。
				half3 ambient = half3(unity_SHAr.w, unity_SHAg.w, unity_SHAb.w);

				// 直接光同时受距离/剔除衰减和阴影衰减影响。
				// shadowAttenuation：1 表示未被遮挡，0 表示完全处于阴影，软阴影时可为中间值。
				half attenuation = mainLight.distanceAttenuation * mainLight.shadowAttenuation;
				half3 color = ambient + (diffuse + specular) * attenuation;

				// 这是材质关键字 _AdditionalLights（大小写敏感），不是 URP 的
				// _ADDITIONAL_LIGHTS。勾选材质开关后，才执行这段手写逐像素附加光循环。
				// 该普通 for 循环只适用于当前项目的 Forward 模式，不是 Forward+ 的集群光循环。
				#ifdef _AdditionalLights
				int lightCount = GetAdditionalLightsCount();
				for (int index = 0; index < lightCount; index ++)
				{
					// 此两参数重载会返回方向、颜色和距离/聚光衰减，
					// 但不会查询附加光阴影，所以其 shadowAttenuation 固定为 1。
					Light light = GetAdditionalLight(index, i.worldPos);
					half3 diffuseAdd = light.color * _Diffuse.rgb * max(0, dot(worldNormal, light.direction));
					half3 additionalHalfDir = normalize(light.direction + viewDir);
					half3 specularAdd = light.color * _Specular.rgb
						* pow(max(0, dot(worldNormal, additionalHalfDir)), _Gloss);
					color +=  (diffuseAdd + specularAdd) * light.distanceAttenuation;
				}
				#endif
				return half4(color, 1.0);
            }
			ENDHLSL
        }

		Pass
		{
			// 第二个 Pass：从灯光视角把物体深度写入阴影贴图，不负责屏幕颜色。
			// URP 的阴影绘制阶段只查找 LightMode = ShadowCaster 的 Pass。
			Tags{"LightMode" = "ShadowCaster"}

			// 双面都投射阴影，适合纸片/栅栏等薄片模型；封闭模型通常也可改回 Cull Back。
			Cull Off
			// 阴影贴图本质上主要保存深度，因此开启深度写入和深度测试。
			ZWrite On
			ZTest LEqual

			HLSLPROGRAM
			#include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Shadows.hlsl"

			// 声明“不开启 / 开启透明度裁剪”两个材质变体。
			// 但当前 Pass 没有纹理、UV、Cutoff，也没有 clip()；所以目前仅声明关键字并不会产生裁剪效果。
            #pragma shader_feature _ALPHATEST_ON

            #pragma vertex vert
            #pragma fragment frag

			// 不是 Properties 中的材质属性。URP 在绘制每张阴影贴图前由 C# 设置这个全局变量，
			// 对方向光表示世界空间中的“表面 -> 光源”方向，用于计算阴影偏移。
			// 当前教学写法只覆盖方向光；点光/聚光的标准 ShadowCaster 还会使用 _LightPosition。
            float3 _LightDirection;

			v2f vert(a2v i)
			{
				v2f o;
				// ShadowCaster 仍要先得到世界位置和世界法线，因为偏移量在世界空间计算。
				float3 worldPos = TransformObjectToWorld(i.vertex.xyz);
				float3 worldNormal = TransformObjectToWorldNormal(i.normal);

				// 为减少表面把自己误判为遮挡物（shadow acne），先沿光线方向和法线偏移，
				// 再把偏移后的位置变换到当前灯光相机的齐次裁剪空间。
				float3 biasedWorldPos = ApplyShadowBias(worldPos, worldNormal, _LightDirection);
				o.pos = TransformWorldToHClip(biasedWorldPos);

				// 不应简单理解成“是否为 DirectX”：UNITY_REVERSED_Z 表示当前图形 API
				// 是否采用反向 Z。这里把偏移后的深度限制在近裁剪面内，防止偏移把顶点推过近裁剪面。
				#if UNITY_REVERSED_Z
					o.pos.z = min(o.pos.z, o.pos.w * UNITY_NEAR_CLIP_VALUE);
				#else
					o.pos.z = max(o.pos.z, o.pos.w * UNITY_NEAR_CLIP_VALUE);
				#endif

				return o;
			}

			half4 frag(v2f i) : SV_Target
			{
				// ShadowCaster 的目标是写深度，返回的颜色通常不会被使用。
				// 片元函数仍然存在，是为了在需要时执行透明度 clip()、LOD 淡出等逐片元丢弃逻辑。
				return 0;
			}
			ENDHLSL
		}
    }
	// URP 不支持该 SubShader/Pass 时显示错误材质，便于尽早发现问题。
	// FallBack 后面填写的是 Shader 名称，不是包内文件路径。
	FallBack "Hidden/Universal Render Pipeline/FallbackError"
}
