Shader "Unity Shaders Book/Chapter 10/Glass Refraction" {
    Properties
    {
        _MainTex("Main Tex", 2D) = "white" {}
        _BumpMap("Normal Map", 2D) = "bump" {}
        _Cubemap("Environment Cubemap", Cube) = "_Skybox" {}
        _Distortion("Distortion", Range(0, 100)) = 10
        _RefractAmount("Refract Amount", Range(0.0, 1.0)) = 1.0
    }
    SubShader
    {
        // Transparent 不透明的物体必须先得绘制完
		Tags { 
            "RenderPipeline"="UniversalPipeline"
            "Queue"="Transparent" 
            "RenderType"="Opaque" 
        }

        Pass{
			HLSLPROGRAM
 
			#include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/DeclareOpaqueTexture.hlsl"

            #pragma vertex vert
            #pragma fragment frag


            CBUFFER_START(UnityPerMaterial)
                float4 _MainTex_ST;
                float4 _BumpMap_ST;
                float _Distortion;
                half _RefractAmount;
            CBUFFER_END
			
            sampler2D _MainTex;
            sampler2D _BumpMap;
            samplerCUBE _Cubemap;

            struct a2v{
                float4 vertex : POSITION;
                float3 normal : NORMAL;
                float4 tangent : TANGENT;
                float2 texcoord: TEXCOORD0;
            };

            struct v2f{
                float4 pos :SV_POSITION;
                float4 uv : TEXCOORD0;
                float4 TtoW0 : TEXCOORD1;
                float4 TtoW1 : TEXCOORD2;
                float4 TtoW2 : TEXCOORD3;
            };

            v2f vert(a2v v)
            {
				v2f o;
				VertexPositionInputs posInputs = GetVertexPositionInputs(v.vertex.xyz);
                o.pos = posInputs.positionCS;                       // 裁剪空间 顶点位置

                // 传递uv
                o.uv.xy = TRANSFORM_TEX(v.texcoord, _MainTex);
                o.uv.zw = TRANSFORM_TEX(v.texcoord, _BumpMap);

                VertexNormalInputs normalInputs = GetVertexNormalInputs(v.normal, v.tangent);
                float3 worldPos =  posInputs.positionWS;                                // 世界空间位置
                half3 worldNormal = normalInputs.normalWS;                              // 世界空间法线
                half3 worldTangent = normalInputs.tangentWS;                            // 世界空间切线
                half3 worldBinormal = normalInputs.bitangentWS;                         // 世界空间副法线)

                // 得到从切线空间到世界空间的转换矩阵
                o.TtoW0 = float4(worldTangent.x, worldBinormal.x, worldNormal.x, worldPos.x);
                o.TtoW1 = float4(worldTangent.y, worldBinormal.y, worldNormal.y, worldPos.y);
                o.TtoW2 = float4(worldTangent.z, worldBinormal.z, worldNormal.z, worldPos.z);
                return o;
            }
            half4 frag(v2f i) : SV_TARGET{
                float3 worldPos = float3(i.TtoW0.w, i.TtoW1.w, i.TtoW2.w);
                half3 worldViewDir = normalize(_WorldSpaceCameraPos.xyz - worldPos);

                // 获取切线空间下的法线
                half3 bump = UnpackNormal(tex2D(_BumpMap, i.uv.zw));

                // 片元的 SV_POSITION 是像素位置；把以渲染像素为单位的偏移换算成 UV。
                float2 screenUV = GetNormalizedScreenSpaceUV(i.pos);
                float2 offsetUV = bump.xy * _Distortion / GetScaledScreenParams().xy;
                // URP 在绘制透明物体前复制不透明画面，玻璃相机需启用 Opaque Texture。
                half3 refrCol = SampleSceneColor(screenUV + offsetUV);

                // 转换切线空间的法线到世界空间
                // 将法线从切线到世界。就是3x3的矩阵乘以3x1的向量：矩阵的每一行与向量的点乘
                bump = normalize(half3(dot(i.TtoW0.xyz, bump), dot(i.TtoW1.xyz, bump), dot(i.TtoW2.xyz, bump)));
                half3 reflDir = reflect(-worldViewDir, bump);
                half4 texColor = tex2D(_MainTex, i.uv.xy);

                // 从立方体贴图中获取反射颜色
                half3 reflCol = texCUBE(_Cubemap, reflDir).rgb * texColor.rgb;

                // 反射(cubemap） * 系数 + 折射（屏幕纹理）+系数 
                half3 finalColor = reflCol * (1-_RefractAmount) + refrCol * _RefractAmount;

                return half4(finalColor, 1.0);
            }
            ENDHLSL
        }
	} 
    FallBack "Hidden/Universal Render Pipeline/FallbackError"
}

