Shader "Unity Shaders Book/Chapter 10/Fresnel" {
    Properties
    {
        _Color ("Color Tint", Color) = (1,1,1,1)
        _FresnelScale("Fresnel Scale", Range(0, 1)) = 1       // _ReflectAmount写错成_RflectAmount
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
			HLSLPROGRAM
			#include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
			#include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"
			
            #pragma vertex vert
            #pragma fragment frag

			CBUFFER_START(UnityPerMaterial)
				half4 _Color;
				half _FresnelScale;
			CBUFFER_END
			
			TEXTURECUBE(_Cubemap);
			SAMPLER(sampler_Cubemap);
			
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
                o.pos = TransformObjectToHClip(v.vertex);     // 顶点位置
            	
                o.worldPos = TransformObjectToWorld(v.vertex);    // 世界空间位置

                o.worldNormal = TransformObjectToWorldNormal(v.normal); // 世界空间法线

                o.worldViewDir = GetCameraPositionWS() - o.worldPos;

                o.worldRefl = reflect(-o.worldViewDir, o.worldNormal);  // 计算世界空间下的反射向量

                return o;
            }
            half4 frag(v2f i) : SV_TARGET{
				float4 shadowCoord = TransformWorldToShadowCoord(i.worldPos);
                Light mainLight = GetMainLight(shadowCoord);
                
                half3 lightDir = normalize(mainLight.direction);                                        // 物体-》灯光
                half3 ambient = SampleSH(i.worldNormal);                                                // 环境
                half3 diffuse = mainLight.color * _Color.rgb * saturate(dot(i.worldNormal, lightDir));  // 漫 sature  saturate把数值限制在 0～1 
            	
            	half3 viewDir = normalize(i.worldViewDir);												// 物体-》摄像机
            	half fresnel = _FresnelScale + (1 - _FresnelScale) * pow(1 - dot(viewDir, i.worldNormal), 5);
            	
            	half3 reflection = SAMPLE_TEXTURECUBE(_Cubemap, sampler_Cubemap, i.worldRefl).rgb;
            	
                half atten = mainLight.distanceAttenuation;                                             // 光照乘数。这个 Shader 里，它相当于一个 0 / 1 开关,点光源可以随距离变暗,平行光不受影响
                half3 color = ambient + lerp(diffuse, reflection, saturate(fresnel)) * atten;
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

/*
dot(worldViewDir, worldNormal):
这是视线方向与表面法线的点积。
当视线垂直于表面时，这个值接近1。
当视线与表面平行（即看向边缘）时，这个值接近0。
1 - dot(worldViewDir, worldNormal):
这个操作反转了上面的结果。
当看向边缘时，这个值接近1。
当垂直看向表面时，这个值接近0。
pow(..., 5):
这个幂运算加强了效果，使边缘更加明显。
_FresnelScale:
这是一个可调节的参数，控制整体效果的强度。
现在，让我们看看这个公式如何产生边缘发光效果：

边缘效果：
当视线接近表面边缘时，dot(worldViewDir, worldNormal) 接近0。
因此，1 - dot(...) 接近1。
经过幂运算后，这个值仍然接近1。
结果是，在边缘处 fresnel 值较大。
中心效果：
当直视表面时，dot(worldViewDir, worldNormal) 接近1。
因此，1 - dot(...) 接近0。
经过幂运算后，这个值变得更接近0。
结果是，在中心处 fresnel 值较小。
平滑过渡：
幂运算（pow(..., 5)）创造了从中心到边缘的平滑过渡。
可调节性：
_FresnelScale 允许调整基础反射率，影响整体效果的强度。
实际应用：

这个 fresnel 值通常用作混合因子或强度系数。
可以用它来混合反射颜色、调整透明度，或者直接作为发光强度。
*/
