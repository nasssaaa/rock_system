import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export interface AppConfig {
    // 1. 地质参数 (Geological Parameters)
    sigma0: number;       // 初始地应力 (MPa)
    kFactor: number;      // 侧压力系数 k
    ucs: number;          // 岩石单轴抗压强度 UCS (MPa)
    gsi: number;          // GSI 指数

    // 2. 算法参数 (Algorithm Parameters)
    bValueWindowSize: number; // b值滑动窗口 (点数)
    energyRatio: number;      // 能量计算等效比例系数

    // 3. 预警参数 (Warning Parameters)
    bValueThreshold: number;  // b值报警下限阈值
    energyThreshold: number;  // 能量报警阈值 (J or kJ/s)
    pointTTL: number;         // 破裂点(AE点)生存时间 TTL (秒)
    replayHalfRange: number;  // 回放模式时间半径 (分钟), 查询中心时间 ± 该值
    liveHistoryHours: number; // Live模式启动时预加载的历史数据时长 (小时)

    // 4. 视觉效果 (Visual Effects)
    showSupports: boolean;    // 显示巷道支护元素
    pointScale: number;       // AE 点尺寸缩放系数
    tunnelOpacity: number;    // 巷道基础透明度
    minStress: number;        // 云图渲染下限 (MPa)
    maxStress: number;        // 云图渲染上限 (MPa)
}

const DEFAULT_CONFIG: AppConfig = {
    sigma0: 25.0,
    kFactor: 1.2,
    ucs: 60.0,
    gsi: 75,
    bValueWindowSize: 200,
    energyRatio: 1.0,
    bValueThreshold: 0.8,
    energyThreshold: 8000,
    pointTTL: 60,
    replayHalfRange: 5,
    liveHistoryHours: 0.5,
    showSupports: true,
    pointScale: 1.0,
    tunnelOpacity: 0.3,
    minStress: 0.0,
    maxStress: 50.0
};

interface ConfigContextType {
    config: AppConfig;
    updateConfig: (newConfig: Partial<AppConfig>) => void;
    resetConfig: () => void;
}

const ConfigContext = createContext<ConfigContextType | undefined>(undefined);

export const ConfigProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [config, setConfig] = useState<AppConfig>(() => {
        try {
            const saved = localStorage.getItem('rock-system-global-config');
            if (saved) {
                return { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
            }
        } catch (e) {
            console.error('Failed to parse config from localStorage', e);
        }
        return DEFAULT_CONFIG;
    });

    useEffect(() => {
        localStorage.setItem('rock-system-global-config', JSON.stringify(config));
    }, [config]);

    const updateConfig = (newConfig: Partial<AppConfig>) => {
        setConfig(prev => ({ ...prev, ...newConfig }));
    };

    const resetConfig = () => {
        setConfig(DEFAULT_CONFIG);
    };

    return (
        <ConfigContext.Provider value={{ config, updateConfig, resetConfig }}>
            {children}
        </ConfigContext.Provider>
    );
};

export const useConfig = (): ConfigContextType => {
    const context = useContext(ConfigContext);
    if (!context) {
        throw new Error('useConfig must be used within a ConfigProvider');
    }
    return context;
};
