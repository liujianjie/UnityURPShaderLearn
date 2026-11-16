Shader "Unity Shaders Book/Chapter 10/ProduceTexture" 
{
    Properties
    {
        _Color ("Color Tint", Color) = (1,1,1,1)
        _MainTex ("Main Tex", 2D) = "white" {}
        _Specular("Specular", Color) = (1, 1, 1,1)
        _Gloss("Gloss", Range(8.0, 256)) = 20
    }
    SubShader
    {
        Tags{
        	"RenderPipeline" = "UniversalPipeline"
        	"RenderType" = "Opaque"
        }
        Pass{
            Tags { "LightMode"="UniversalForward" }

            HLSLPROGRAM
			#include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"//URP引用标配
			#include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"//光照渲染标配引用

            #pragma vertex vert
            #pragma fragment frag

			CBUFFER_START(UnityPerMaterial)
				half4 _Color;
                sampler2D _MainTex;
				half4 _MainTex_ST;
				half4 _Specular;
			    float _Gloss;
			CBUFFER_END

            struct a2v{
                float4 vertex : POSITION;
                float3 normal : NORMAL;
                float4 texcoord : TEXCOORD0;
            };
            struct v2f{
                float4 pos : SV_POSITION;
                float3 worldNormal : TEXCOORD0;
                float3 worldPos : TEXCOORD1;
                float2 uv : TEXCOORD2;
            };

            v2f vert(a2v v)
            {
                v2f o;
                o.pos = TransformObjectToHClip(v.vertex);                                   // 顶点位置到裁剪空间
            
                o.worldNormal = TransformObjectToWorldNormal(v.normal);                     // 世界空间法线
            
                o.worldPos = TransformObjectToWorld(v.vertex);                              // 世界空间位置

                o.uv = v.texcoord.xy * _MainTex_ST.xy + _MainTex_ST.zw;

                return o;
            }
            half4 frag(v2f i) : SV_TARGET{
                Light mainLight = GetMainLight();                                           // 获取光源信息
                // half3 worldNormal = normalize(i.worldNormal);                            // 应该要把法线归一化，不然影响光强度
                half3 worldLightDir = normalize(mainLight.direction);                       // 得到光的方向，  物体-》光源
                half3 viewDir = normalize(_WorldSpaceCameraPos.xyz - i.worldPos);           // 物体到人眼位置，物体-》人眼
                half3 halfDir = normalize(worldLightDir + viewDir);                         // 半程向量方向，  光源和视角的中间

                
                half3 albedo = tex2D(_MainTex, i.uv).rgb * _Color.rgb;
                float3 diffuse = mainLight.color * albedo * max(0, dot(i.worldNormal, worldLightDir));                      // 漫
                float3 specular = mainLight.color * _Specular.rgb * pow(max(0, dot(i.worldNormal, halfDir)), _Gloss);       // 镜面
                half3 ambient = half3(unity_SHAr.w, unity_SHAg.w, unity_SHAb.w);                                            // 环境光
                half atten = mainLight.distanceAttenuation;
                half3 color = ambient + (diffuse + specular) * atten;                                                       // 主光源颜色
                return half4(color, 1.0);
            }
            ENDHLSL
        }
    }
    FallBack "Specular"
}
