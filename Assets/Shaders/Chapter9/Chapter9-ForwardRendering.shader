
Shader "Unity Shaders Book/Chapter 9/Forward Rendering" {
    Properties
    {
		_Diffuse ("Diffuse", Color) = (1, 1, 1, 1)
		_Specular ("Specular", Color) = (1, 1, 1, 1)
		_Gloss ("Gloss", Range(8.0, 256)) = 20
    	[Toggle(_AdditionalLights)]_AddLights("AddLights", Float) = 1
    }
    SubShader
    {
        Tags{
        	"RenderPipeline" = "UniversalPipeline"
        	"RenderType" = "Opaque"
        }
        // 处理影响该物体的逐像素光源：点光源、聚光灯、区域光（有区域光）
        Pass{
            Tags { "LightMode"="UniversalForward" }

            HLSLPROGRAM
			#include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"//URP引用标配
			#include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"//光照渲染标配引用
			
			#pragma shader_feature _AdditionalLights//多光源计算的开关变量
            #pragma vertex vert
            #pragma fragment frag
				
			CBUFFER_START(UnityPerMaterial)
				half4 _Diffuse;
				half4 _Specular;
				float _Gloss;
			CBUFFER_END
			
            struct a2v{
                float4 vertex : POSITION;
                float3 normal : NORMAL;
            };
            struct v2f{
                float4 pos : SV_POSITION;
                float3 worldNormal : TEXCOORD0;
                float3 worldPos : TEXCOORD1;
            };

            v2f vert(a2v v)
            {
                v2f o;
                o.pos = TransformObjectToHClip(v.vertex);				// 顶点位置到裁剪空间

                o.worldNormal = TransformObjectToWorldNormal(v.normal); // 世界空间法线

                o.worldPos = TransformObjectToWorld(v.vertex);			// 世界空间位置

                return o;
            }
            half4 frag(v2f i) : SV_TARGET{
            	Light mainLight = GetMainLight();// 获取光源信息
            	half3 worldLightDir = normalize(mainLight.direction);							// 得到光的方向,    物体->光源
                half3 viewDir = normalize(_WorldSpaceCameraPos.xyz - i.worldPos);				// 物体到人眼位置,  物体->人眼
            	half3 halfDir = normalize(worldLightDir + viewDir);								// 半程向量方向，   光源和视角的中间
            	
                half3 diffuse = mainLight.color * _Diffuse.rgb * max(0, dot(i.worldNormal, worldLightDir));				// 漫
            	half3 specular = mainLight.color * _Specular.rgb * pow(max(0, dot(i.worldNormal, halfDir)), _Gloss);	// 镜面高光
            	half3 ambient = half3(unity_SHAr.w, unity_SHAg.w, unity_SHAb.w);										// 环境光
				half atten = mainLight.distanceAttenuation;
            	
            	half3 color = ambient + (diffuse + specular) * atten;// 主光源颜色
            	
            	#ifdef _AdditionalLights
            	int lightCount = GetAdditionalLightsCount();
            	for (int index = 0; index < lightCount; index ++)
            	{
            		Light light = GetAdditionalLight(index, i.worldPos);
            		half3 diffuseAdd = light.color * _Diffuse.rgb * max(0, dot(i.worldNormal, light.direction));
            		half3 halfDir = normalize(light.direction + viewDir);
            		half3 specularAdd = light.color * _Specular.rgb * pow(max(0, dot(i.worldNormal, halfDir)), _Gloss);
            		color +=  (diffuseAdd + specularAdd) * light.distanceAttenuation;
            	}
            	#endif
            	return half4(color, 1.0);
            }
            ENDHLSL
        }
        // 处理影响该物体的逐像素光源：点光源、聚光灯、区域光（但是这里没有区域光）
   //      Pass{
			// Tags{"LightMode"="ForwardAdd"}
   //
			// Blend One One
   //
			// CGPROGRAM
			//
			// // Apparently need to add this declaration 
			// // #pragma multi_compile_fwdbase	
			// #pragma multi_compile_fwdadd		// 这个写错fwdbase不行。
			//
			// #pragma vertex vert
			// #pragma fragment frag
			//
			// #include "Lighting.cginc"
			// #include "AutoLight.cginc"
			//
			// fixed4 _Diffuse;
			// fixed4 _Specular;
			// float _Gloss;
			//
			// struct a2v {
			// 	float4 vertex : POSITION;
			// 	float3 normal : NORMAL;
			// };
			//
			// struct v2f {
			// 	float4 pos : SV_POSITION;
			// 	float3 worldNormal : TEXCOORD0;
			// 	float3 worldPos : TEXCOORD1;
			// };
			//
			// v2f vert(a2v v) {
			// 	v2f o;
			// 	o.pos = UnityObjectToClipPos(v.vertex);
			// 	
			// 	o.worldNormal = UnityObjectToWorldNormal(v.normal);
			// 	
			// 	o.worldPos = mul(unity_ObjectToWorld, v.vertex).xyz;
			// 	
			// 	return o;
			// }
			//
			// fixed4 frag(v2f i) : SV_Target {
			// 	fixed3 worldNormal = normalize(i.worldNormal);
			// 	#ifdef USING_DIRECTIONAL_LIGHT
			// 		fixed3 worldLightDir = normalize(_WorldSpaceLightPos0.xyz);
			// 	#else
			// 		fixed3 worldLightDir = normalize(_WorldSpaceLightPos0.xyz - i.worldPos.xyz);
			// 	#endif
   //
			//  	fixed3 diffuse = _LightColor0.rgb * _Diffuse.rgb * max(0, dot(worldNormal, worldLightDir));
   //
			//  	fixed3 viewDir = normalize(_WorldSpaceCameraPos.xyz - i.worldPos.xyz);
			//  	fixed3 halfDir = normalize(worldLightDir + viewDir);
			//  	fixed3 specular = _LightColor0.rgb * _Specular.rgb * pow(max(0, dot(worldNormal, halfDir)), _Gloss);
   //
			// 	#ifdef USING_DIRECTIONAL_LIGHT
			// 		fixed atten = 1.0;
			// 	#else
			// 		#if defined (POINT)
			// 			// 将世界坐标转换为光源空间坐标
			// 			float3 lightCoord = mul(unity_WorldToLight, float4(i.worldPos, 1)).xyz;
			// 			// 使用纹理作为查找表
			// 			fixed atten = tex2D(_LightTexture0, dot(lightCoord, lightCoord).rr).UNITY_ATTEN_CHANNEL;
			// 		#elif defined (SPOT)
			// 			float4 lightCoord = mul(unity_WorldToLight, float4(i.worldPos, 1));
			// 			fixed atten = (lightCoord.z > 0) * tex2D(_LightTexture0, lightCoord.xy / lightCoord.w + 0.5).w * 
			// 						tex2D(_LightTextureB0, dot(lightCoord, lightCoord).rr).UNITY_ATTEN_CHANNEL;
			// 		#else
			// 			fixed atten = 1.0;
			// 		#endif
			// 	#endif
   //
			// 	return fixed4((diffuse + specular) * atten, 1.0);
			// }
			// ENDCG
   //      }
    }
	FallBack "Packages/com.unity.render-pipelines.universal/FallbackError"
}
