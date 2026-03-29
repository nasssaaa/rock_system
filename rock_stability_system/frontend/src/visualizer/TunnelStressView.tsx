import React, { useRef, useMemo, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { useConfig } from '../contexts/ConfigContext';

// --- 类型声明 ---
export interface AESphereData {
    id: string;
    position: [number, number, number];
    energy: number; // J
    category?: 'error' | 'shallow' | 'deep';
    b_value?: number;
    warning?: boolean;
    magnitude?: number;
    timestamp?: number;
    ws_receive_time?: number;
}

export interface StressDataPoint {
    x: number;
    y: number;
    z: number;
    sigma: number; // 应力大小 (MPa)
}

interface TunnelStressViewProps {
    stressData?: StressDataPoint[]; // (后续可接后端实际应力场数据)
    minStress?: number;
    maxStress?: number;
    plasticZoneRadius?: number; // 塑性区半径，由前端输入参数传入或计算所得

    // --- 外部注入的控制状态 ---
    globalMode?: 'live' | 'history' | 'evolution';
    globalRenderData?: AESphereData[];
    globalCumulativeStressData?: StressDataPoint[];
    liveEventsRef?: React.MutableRefObject<AESphereData[]>;
    liveEventsTotalCount?: number;
    showSupports?: boolean;
}

// 颜色映射辅助函数 (经典蓝绿黄红应力色谱)
const getStressColor = (sigma: number, min: number, max: number): THREE.Color => {
    const ratio = Math.max(0, Math.min(1, (sigma - min) / (max - min)));
    const color = new THREE.Color();
    if (ratio < 0.25) {
        color.setHSL(0.6, 1, 0.5 - ratio); // Blue to Light Blue
    } else if (ratio < 0.5) {
        color.setHSL(0.3 + (0.5 - ratio) * 1.2, 1, 0.5); // Light Blue to Green
    } else if (ratio < 0.75) {
        color.setHSL(0.15 + (0.75 - ratio) * 0.6, 1, 0.5); // Green to Yellow
    } else {
        color.setHSL((1 - ratio) * 0.6, 1, 0.5); // Yellow to Red
    }
    return color;
};

// 1. 静态主巷道与应力云图着色组件
const TunnelMesh: React.FC<{ stressData: StressDataPoint[], minStress: number, maxStress: number, tunnelOpacity: number }> = ({ stressData, minStress, maxStress, tunnelOpacity }) => {
    const geometry = useMemo(() => new THREE.CylinderGeometry(3, 3, 20, 32, 20, true), []);
    // 使用 Vertex Colors 进行应力着色
    const colors = useMemo(() => {
        const positionAttribute = geometry.getAttribute('position');
        const colorArray = new Float32Array(positionAttribute.count * 3);
        const baseColor = new THREE.Color(0x374151); // 默认灰色岩体 (Slate-700)

        for (let i = 0; i < positionAttribute.count; i++) {
            const vx = positionAttribute.getX(i);
            const vy = positionAttribute.getY(i);
            const vz = positionAttribute.getZ(i);

            // 查找最近的应力控制点 (简化的反距离加权可在此处扩展，当前仅找最近点)
            let nearestSigma = 0;
            let minDist = Infinity;

            if (stressData && stressData.length > 0) {
                for (let pt of stressData) {
                    const d = Math.sqrt((vx - pt.x) ** 2 + (vy - pt.y) ** 2 + ((vz - pt.z) ** 2) * 0.1); // Z 轴弱衰减
                    if (d < minDist) {
                        minDist = d;
                        nearestSigma = pt.sigma;
                    }
                }
                // 如果极其靠近控制点，进行染色；否则平滑回基础色
                if (minDist < 4.0) {
                    const c = getStressColor(nearestSigma, minStress, maxStress);
                    // 根据距离混合基础色
                    const mixRatio = Math.max(0, 1 - minDist / 4.0);
                    baseColor.clone().lerp(c, mixRatio).toArray(colorArray, i * 3);
                    continue;
                }
            }
            baseColor.toArray(colorArray, i * 3);
        }
        return colorArray;
    }, [geometry, stressData, minStress, maxStress]);

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    return (
        <mesh geometry={geometry} rotation={[Math.PI / 2, 0, 0]}>
            <meshStandardMaterial vertexColors side={THREE.DoubleSide} wireframe={true} transparent opacity={tunnelOpacity} />
            <meshStandardMaterial vertexColors side={THREE.DoubleSide} depthWrite={true} />
        </mesh>
    );
};

// 2A. 独立渲染的强震等级涟漪特效 ($M > 0$)
const AEMagnitudeRipple: React.FC<{ position: [number, number, number], category?: string }> = ({ position, category }) => {
    const rippleRef = useRef<THREE.Mesh>(null);
    const baseColor = category === 'error' ? '#64748b' : category === 'shallow' ? '#facc15' : '#ef4444';

    useFrame(({ clock }) => {
        if (rippleRef.current) {
            const rippleLife = (clock.elapsedTime * 2) % 1.5; // 波纹生命周期
            const rippleScale = 1 + rippleLife * 5; // 扩散
            rippleRef.current.scale.set(rippleScale, rippleScale, rippleScale);
            // 渐隐效果
            if (rippleRef.current.material instanceof THREE.Material) {
                rippleRef.current.material.opacity = Math.max(0, 0.8 - rippleLife / 1.5);
            }
        }
    });

    return (
        <mesh ref={rippleRef} position={position} rotation={[Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.4, 0.5, 32]} />
            <meshBasicMaterial
                color={baseColor}
                transparent
                opacity={0.8}
                side={THREE.DoubleSide}
                depthWrite={false}
            />
        </mesh>
    );
};

// 2B. 性能优化的前台实况微震统一着色 InstancedMesh (环形缓冲版)
const MAX_LIVE_INSTANCES = 5000;
const LiveAEInstancedMesh: React.FC<{ events: AESphereData[], liveEventsRef?: React.MutableRefObject<AESphereData[]>, liveEventsTotalCount?: number, pointScale: number, globalMode?: string }> = ({ events, liveEventsRef, liveEventsTotalCount, pointScale, globalMode }) => {
    const meshRef = useRef<THREE.InstancedMesh>(null);
    const dummy = useMemo(() => new THREE.Object3D(), []);
    const lastRenderedCount = useRef(-1);

    // 独占预分配生命周期数组缓存区，严禁在 useFrame 中 new Float32Array
    const birthTimesRef = useRef(new Float32Array(MAX_LIVE_INSTANCES));

    // 使用带有自定义 Shader 着色的材质以完成 GPU-level 时间消隐 (Fade Out)
    const fadeMaterial = useMemo(() => {
        const mat = new THREE.MeshStandardMaterial({
            transparent: true,
            depthWrite: false, // 防止透明叠加破面渲染错误
        });

        mat.onBeforeCompile = (shader) => {
            shader.uniforms.uTime = { value: Date.now() / 1000 };
            shader.uniforms.uTunnelRadius = { value: 3.0 }; // 巷道空腔半径阈值
            shader.uniforms.uIsHistory = { value: 0.0 };
            mat.userData.shader = shader; // 挂载给外部访问同步流

            shader.vertexShader = `
                attribute float instanceBirthTime;
                varying float vAgeAlpha;
                uniform float uTime;
                uniform float uTunnelRadius;
                uniform float uIsHistory;
                ${shader.vertexShader}
            `.replace(
                `#include <project_vertex>`,
                `#include <project_vertex>
                // 获取当前实例化对象的世界坐标系质心
                vec3 instanceCenter = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
                // 计算 XY 轴截面的径向距离 (假设主巷道沿 Z 轴分布)
                float r = sqrt(instanceCenter.x * instanceCenter.x + instanceCenter.y * instanceCenter.y);
                // 空间判定：如果质心位于空腔内，直接将裁剪坐标偏移至 NDC (归一化设备坐标) 之外，彻底跳过片元光栅化
                if (r < uTunnelRadius) {
                    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
                }
                `
            ).replace(
                `#include <color_vertex>`,
                `#include <color_vertex>
                float age = uTime - instanceBirthTime;
                if (uIsHistory > 0.5) {
                    vAgeAlpha = 1.0;
                } else {
                    vAgeAlpha = clamp(1.0 - (age / 600.0), 0.0, 1.0);
                }
                `
            );

            shader.fragmentShader = `
                varying float vAgeAlpha;
                ${shader.fragmentShader}
            `.replace(
                `vec4 diffuseColor = vec4( diffuse, opacity );`,
                `vec4 diffuseColor = vec4( diffuse, opacity * vAgeAlpha );`
            );
        };
        return mat;
    }, []);

    // 独立解耦的硬件级同步渲染：彻底脱离 React State，每帧轮询 Ref 指针
    useFrame(() => {
        if (fadeMaterial.userData.shader) {
            fadeMaterial.userData.shader.uniforms.uTime.value = Date.now() / 1000;
            fadeMaterial.userData.shader.uniforms.uIsHistory.value = globalMode === 'history' ? 1.0 : 0.0;
        }

        if (!meshRef.current) return;

        const currentEvents = liveEventsRef ? liveEventsRef.current : events;
        // Optimization: 只在数据量或引用变更时更新巨幅矩阵拷贝
        const totalEventsCount = liveEventsTotalCount !== undefined ? liveEventsTotalCount : currentEvents.length;
        if (totalEventsCount === lastRenderedCount.current) return;
        lastRenderedCount.current = totalEventsCount;

        // 【基于环形缓冲的优先渲染回放机制】
        // 注：受制于 "按能量排序最危险的 MAX个" 这个硬性业务需求，其实我们目前很难彻底做到 O(1) 尾随插入(因为新点能量不一定大于老点，随时需要洗牌)。
        // 所以我们仍然需要取最近的事件（最多20000个），再 sort 出 5000 个最危点进行重新赋位
        let validEvents = currentEvents;

        // 如果我们使用的是 20000 固定预分配的 Buffer
        if (liveEventsRef) {
            const arr = liveEventsRef.current;
            const validCount = Math.min(totalEventsCount, 20000);
            if (validCount === 0) return;
            if (totalEventsCount <= 20000) {
                validEvents = arr.slice(0, totalEventsCount);
            } else {
                const pivot = totalEventsCount % 20000;
                validEvents = [...arr.slice(pivot), ...arr.slice(0, pivot)];
            }
        }

        let renderEvents = validEvents;
        if (validEvents.length > MAX_LIVE_INSTANCES) {
            // 这是业务开销最大的步骤，但依然在 useFrame 里完成，远好于 React Component Update
            renderEvents = [...validEvents].sort((a, b) => b.energy - a.energy).slice(0, MAX_LIVE_INSTANCES);
        }

        const count = renderEvents.length;
        meshRef.current.count = count;

        const birthTimes = birthTimesRef.current;

        for (let i = 0; i < count; i++) {
            const event = renderEvents[i];
            const isHighEnergy = event.energy > 8000;
            const scaleFactor = pointScale * (event.category === 'error' ? 0.05 : (isHighEnergy ? 1.5 : 1.0) * (event.energy / 5000));

            dummy.position.set(event.position[0], event.position[1], event.position[2]);
            dummy.scale.set(scaleFactor, scaleFactor, scaleFactor);
            dummy.updateMatrix();
            meshRef.current.setMatrixAt(i, dummy.matrix);

            const colorHex = event.category === 'error' ? '#64748b' : event.category === 'shallow' ? '#facc15' : '#ef4444';
            meshRef.current.setColorAt(i, new THREE.Color(colorHex));

            // 直接覆盖预分配数组
            birthTimes[i] = event.timestamp || (Date.now() / 1000);
        }

        meshRef.current.geometry.setAttribute('instanceBirthTime', new THREE.InstancedBufferAttribute(birthTimes, 1));

        meshRef.current.instanceMatrix.needsUpdate = true;
        if (meshRef.current.instanceColor) {
            meshRef.current.instanceColor.needsUpdate = true;
        }

        // 手动触发整体矩阵更新，因为我们禁用了自动更新，仅在内部位移变化时重新计算它的世界包围盒矩阵
        meshRef.current.updateMatrix();

        // --- 前端渲染性能耗时统计 ---
        // if (renderEvents.length > 0 && renderEvents[renderEvents.length - 1].ws_receive_time) {
        //     const rxTime = renderEvents[renderEvents.length - 1].ws_receive_time!;
        //     // 因为 useFrame 运行在一个独立的 60帧循环，这不再是 React 虚拟 DOM 的调和时间
        //     const renderTimeMs = performance.now() - rxTime;
        //     if (renderTimeMs > 16.0) {
        //         console.warn(`[Performance] ⚠️ InstancedMesh (useFrame) 渲染拷贝耗时超过 16ms: ${renderTimeMs.toFixed(2)}ms`);
        //     }
        // }
    });

    return (
        <instancedMesh ref={meshRef} args={[undefined, undefined, MAX_LIVE_INSTANCES]} frustumCulled={false} matrixAutoUpdate={false}>
            <sphereGeometry args={[0.3, 16, 16]} />
            <primitive object={fadeMaterial} attach="material" />
        </instancedMesh>
    );
};

// 3. 性能优化的批量云图 (仅在 Evolution 模式下启用)
const AEInstancedCloud: React.FC<{ events: AESphereData[] }> = ({ events }) => {
    const meshRef = useRef<THREE.InstancedMesh>(null);
    const dummy = useMemo(() => new THREE.Object3D(), []);

    useEffect(() => {
        if (meshRef.current) {
            meshRef.current.count = events.length;
            events.forEach((event, i) => {
                dummy.position.set(event.position[0], event.position[1], event.position[2]);
                const baseScale = (event.energy / 5000) * 0.5;
                dummy.scale.set(baseScale, baseScale, baseScale);
                dummy.updateMatrix();
                meshRef.current!.setMatrixAt(i, dummy.matrix);

                const color = new THREE.Color(
                    event.category === 'error' ? 0x64748b :
                        event.category === 'shallow' ? 0xfacc15 :
                            0xef4444
                );
                meshRef.current!.setColorAt(i, color);
            });
            meshRef.current.instanceMatrix.needsUpdate = true;
            if (meshRef.current.instanceColor) {
                meshRef.current.instanceColor.needsUpdate = true;
            }
        }
    }, [events, dummy]);

    return (
        <instancedMesh ref={meshRef} args={[undefined, undefined, events.length]} frustumCulled={false}>
            <sphereGeometry args={[0.2, 8, 8]} />
            <meshBasicMaterial transparent opacity={0.6} depthWrite={false} blending={THREE.AdditiveBlending} />
        </instancedMesh>
    );
};

// 4. 位移速率箭头指示器
const DynamicArrow: React.FC<{ origin: [number, number, number], dir: [number, number, number], baseRate: number, colorHex: number }> = ({ origin, dir, baseRate, colorHex }) => {
    const arrowHelperRef = useRef<THREE.ArrowHelper>(null);
    useFrame(({ clock }) => {
        if (arrowHelperRef.current) {
            const pulse = 1 + 0.3 * Math.sin(clock.elapsedTime * 4);
            arrowHelperRef.current.setLength(baseRate * pulse, 0.4 * pulse, 0.2 * pulse);
        }
    });

    const initDir = useMemo(() => new THREE.Vector3(...dir).normalize(), [dir]);

    return (
        <arrowHelper ref={arrowHelperRef} args={[initDir, new THREE.Vector3(...origin), baseRate, colorHex, 0.4, 0.2]} />
    );
}

const DisplacementArrows: React.FC = () => {
    const points = useMemo(() => [
        { origin: [0, 3.2, 0], dir: [0, -1, 0], rate: 0.8, color: 0xef4444 },
        { origin: [0, 3.2, 5], dir: [0, -1, 0], rate: 1.2, color: 0xef4444 },
        { origin: [0, 3.2, -5], dir: [0, -1, 0], rate: 0.5, color: 0xeab308 },
        { origin: [-3.2, 0, 2], dir: [1, 0, 0], rate: 0.9, color: 0xef4444 },
        { origin: [-3.2, 0, -3], dir: [1, 0, 0], rate: 0.4, color: 0x3b82f6 },
        { origin: [3.2, 0, 0], dir: [-1, 0, 0], rate: 1.1, color: 0xef4444 },
        { origin: [3.2, 0, -6], dir: [-1, 0, 0], rate: 0.6, color: 0xeab308 },
    ], []);

    return (
        <group>
            {points.map((pt, i) => (
                <DynamicArrow key={i} origin={pt.origin as [number, number, number]} dir={pt.dir as [number, number, number]} baseRate={pt.rate} colorHex={pt.color} />
            ))}
        </group>
    );
};

// 5. 动态岩石锚杆阵列 (Rock Bolts)
const RockBolts: React.FC<{ events: AESphereData[] }> = ({ events }) => {
    const meshRef = useRef<THREE.InstancedMesh>(null);
    const dummy = useMemo(() => new THREE.Object3D(), []);

    // 生成锚杆坐标 (按 1m x 1m 间距)
    // 巷道半径 3m, 长 20m (-10 to 10)
    // 长度方向间隔 1m -> 21 排
    // 弧线方向间隔 1m -> 周长 2*pi*3 ≈ 18.8m -> 取 18 个/排
    const boltPositions = useMemo(() => {
        const positions: { pos: [number, number, number], normal: [number, number, number] }[] = [];
        const radius = 3.0; // 锚杆打在巷道壁表面
        for (let z = -10; z <= 10; z += 1.0) {
            for (let i = 0; i < 18; i++) {
                const angle = (i / 18) * Math.PI * 2;
                const x = Math.cos(angle) * radius;
                const y = Math.sin(angle) * radius;
                positions.push({ pos: [x, y, z], normal: [x / radius, y / radius, 0] });
            }
        }
        return positions;
    }, []);

    useEffect(() => {
        if (meshRef.current) {
            boltPositions.forEach((bolt, i) => {
                // 计算当前锚杆周围 1.5m 范围内的 AE 破裂点总能量
                let localEnergySum = 0;
                events.forEach(ev => {
                    const dx = ev.position[0] - bolt.pos[0];
                    const dy = ev.position[1] - bolt.pos[1];
                    const dz = ev.position[2] - bolt.pos[2];
                    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
                    if (dist <= 1.5) {
                        localEnergySum += ev.energy;
                    }
                });

                // 设置颜色: 正常深灰 -> 载荷过大警戒(橙色) -> 极限危急(红色)
                let colorHex = 0x94a3b8; // 默认 slate-400 (金属灰)
                if (localEnergySum > 15000) {
                    colorHex = 0xef4444; // 红色
                } else if (localEnergySum > 5000) {
                    colorHex = 0xf97316; // 橙色
                }

                // 实例化矩阵设定
                dummy.position.set(bolt.pos[0], bolt.pos[1], bolt.pos[2]);
                // 锚杆指向巷道外部法线方向
                dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...bolt.normal));
                // 为了让锚杆一半在里一半在外，位置沿法线外移一点
                dummy.position.addScaledVector(new THREE.Vector3(...bolt.normal), 0.5);
                dummy.updateMatrix();

                meshRef.current!.setMatrixAt(i, dummy.matrix);
                meshRef.current!.setColorAt(i, new THREE.Color(colorHex));
            });

            meshRef.current.instanceMatrix.needsUpdate = true;
            if (meshRef.current.instanceColor) {
                meshRef.current.instanceColor.needsUpdate = true;
            }
        }
    }, [events, boltPositions, dummy]);

    return (
        <instancedMesh ref={meshRef} args={[undefined, undefined, boltPositions.length]} frustumCulled={false}>
            {/* 锚杆形状：细长圆柱 */}
            <cylinderGeometry args={[0.05, 0.05, 1.5, 8]} />
            <meshStandardMaterial metalness={0.6} roughness={0.4} />
        </instancedMesh>
    );
};

// ----------------------------------------------------
// 主渲染组件：现在完全作为被动呈现器
// ----------------------------------------------------
// ----------------------------------------------------
const TunnelStressView: React.FC<TunnelStressViewProps> = (props) => {
    const { globalMode = 'live', globalRenderData = [], globalCumulativeStressData = [], showSupports = false } = props;
    const { config } = useConfig();

    return (
        <Canvas camera={{ position: [10, 5, 15], fov: 50 }} className="w-full h-full">
            <ambientLight intensity={0.4} />
            <directionalLight position={[10, 10, 10]} intensity={1} />

            {/* 渲染着色巷道网格 */}
            <TunnelMesh
                stressData={globalCumulativeStressData}
                minStress={config.minStress}
                maxStress={config.maxStress}
                tunnelOpacity={config.tunnelOpacity}
            />

            {/* 渲染半透明塑性区危险包络体 */}
            {props.plasticZoneRadius && props.plasticZoneRadius > 3.0 && (
                <mesh rotation={[Math.PI / 2, 0, 0]}>
                    <cylinderGeometry args={[props.plasticZoneRadius, props.plasticZoneRadius, 20, 64, 1, true]} />
                    <meshStandardMaterial
                        color="#ef4444"
                        transparent={true}
                        opacity={0.3}
                        side={THREE.DoubleSide}
                        depthWrite={false}
                        blending={THREE.AdditiveBlending}
                    />
                </mesh>
            )}

            {/* 动态渲染推送过来的微震源闪烁球 */}
            {globalMode !== 'evolution' && (
                <>
                    <LiveAEInstancedMesh events={globalRenderData} liveEventsRef={props.liveEventsRef} liveEventsTotalCount={props.liveEventsTotalCount} pointScale={config.pointScale} globalMode={globalMode} />
                    {/* 仅针对 $M > 0$ 提取涟漪独立渲染 */}
                    {globalRenderData.filter(e => e.magnitude && e.magnitude > 0 && e.category !== 'error').map(event => (
                        <AEMagnitudeRipple key={`ripple-${event.id}`} position={event.position} category={event.category} />
                    ))}
                </>
            )}

            {/* 应力演化模式：InstancedMesh 热力云团与位移矢量箭头 */}
            {globalMode === 'evolution' && (
                <>
                    <AEInstancedCloud events={globalRenderData} />
                    <DisplacementArrows />
                </>
            )}

            {/* 可选展示的三维锚杆支护系统 */}
            {showSupports && (
                <RockBolts events={globalRenderData} />
            )}

            <OrbitControls enableZoom={true} enablePan={true} enableRotate={true} />
            <axesHelper args={[5]} />
        </Canvas>
    );
};

export default TunnelStressView;
