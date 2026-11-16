Shader "Unity Shaders Book/Chapter 10/Reflection" {
    Properties
    {
        _Color ("Color Tint", Color) = (1,1,1,1)
        _ReflectColor("Reflection Color", Color) = (1, 1, 1, 1)
        _ReflectAmount("Reflect Amount", Range(0, 1)) = 1       // _ReflectAmount写错成_RflectAmount
        _Cubemap("Reflection Cubemap", Cube) = "_Skybox" {}
    }
    SubShader
    {
		Tags {
		    "RenderPipeline"="UniversalPipeline"
		    "Queue"="Geometry"
		    "RenderType"="Opaque"
		}
        Pass{
            Tags { "LightMode"="UniversalForward" }
            
			HLSLPROGRAM
			#include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
			#include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"
			
            #pragma vertex vert
            #pragma fragment frag

            CBUFFER_START(UnityPerMaterial)
                half4 _Color;
                half4 _ReflectColor;
                half _ReflectAmount;
			CBUFFER_END
			
			TEXTURECUBE(_Cubemap);              // 是从哪张贴图读。它对应材质上的 Reflection Cubemap 槽。可以把它想成一个立方体盒子，六个面各有一张图，记录六个方向看到的环境
			SAMPLER(sampler_Cubemap);           // sampler_Cubemap是怎么读。比如采样位置落在几个纹素之间，是取最近的一个，还是把附近颜色混合起来

            struct a2v{
                float4 vertex : POSITION;
                float3 normal : NORMAL;
            };
            struct v2f{
                float4 pos : SV_POSITION;
                half3 worldPos : TEXCOORD0;
                half3 worldNormal : TEXCOORD1;
                half3 worldViewDir : TEXCOORD2;
                half3 worldRefl : TEXCOORD3;
            };

            v2f vert(a2v v)
            {
                v2f o;
                o.pos = TransformObjectToHClip(v.vertex.xyz);           // 顶点位置

                o.worldPos = TransformObjectToWorld(v.vertex.xyz);      // 世界空间位置
                
                o.worldNormal = TransformObjectToWorldNormal(v.normal);       // 世界空间法线

                o.worldViewDir = GetCameraPositionWS() - o.worldPos;          // 摄像机方向（物体->摄像机）

                o.worldRefl = reflect(-o.worldViewDir, o.worldNormal);      // 计算世界空间下的反射向量， -o.worldViewDir 是 摄像机-》物体
                return o;
            }
            half4 frag(v2f i) : SV_TARGET{
                float4 shadowCoord = TransformWorldToShadowCoord(i.worldPos);
                Light mainLight = GetMainLight(shadowCoord);
                
                half3 lightDir = normalize(mainLight.direction);                                        // 物体-》灯光
                half3 ambient = SampleSH(i.worldNormal);                                                // 环境
                half3 diffuse = mainLight.color * _Color.rgb * saturate(dot(i.worldNormal, lightDir));  // 漫 sature  saturate把数值限制在 0～1 
                
                // 使用世界空间下的反射向量去采样Cubemap
                half3 reflection = SAMPLE_TEXTURECUBE(_Cubemap, sampler_Cubemap, i.worldRefl).rgb * _ReflectColor.rgb; // 前两个参数指定读哪张贴图、按什么规则读。第三个 i.worldRefl 指定朝哪个方向读
                
                half atten = mainLight.distanceAttenuation;                                             // 光照乘数。这个 Shader 里，它相当于一个 0 / 1 开关,点光源可以随距离变暗,平行光不受影响
                half3 color = ambient + lerp(diffuse, reflection, _ReflectAmount) * atten;
                return half4(color, 1.0);
            }
            ENDHLSL
        }
        UsePass "Universal Render Pipeline/Lit/ShadowCaster"  // 给当前 SubShader 加一个投射阴影的 Pass
        /*
        URP 生成阴影贴图时，用借来的 ShadowCaster 从灯光视角记录球的深度。这样，地面就能判断自己有没有被球挡住。球能投影到地面，和球自己能不能接收阴影是两回事；后者取决于球自己的颜色计算有没有用到 shadowAttenuation
        */
	}
    FallBack "Packages/com.unity.render-pipelines.universal/FallbackError"
}
