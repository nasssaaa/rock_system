import React, { useEffect, useState } from 'react';
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    ReferenceLine
} from 'recharts';
import { useConfig } from '../contexts/ConfigContext';

export interface BValueDataPoint {
    timestamp: string;
    b_value: number;
    warning: boolean;
}

interface BValueTrendChartProps {
    data: BValueDataPoint[]; // 随时间推移的 b 值记录数组
}

export const BValueTrendChart: React.FC<BValueTrendChartProps> = ({ data }) => {
    const { config } = useConfig();
    const [showAlert, setShowAlert] = useState(false);
    const ALERT_THRESHOLD = config.bValueThreshold;

    // 监听最新数据的警告状态，触发全屏级或局部通知
    useEffect(() => {
        if (data.length === 0) return;
        const latestPoint = data[data.length - 1];

        // 仅当实质性触及危险阈值时，才触发全屏红色极高危警告 Overlay
        if (latestPoint.b_value < ALERT_THRESHOLD) {
            setShowAlert(true);
        } else {
            // 当 b 值重新回到安全水平线上方时，立即关闭红色全屏报警，防止状态卡死
            setShowAlert(false);
        }
    }, [data, ALERT_THRESHOLD]);

    // 判断整条折线是否因为处于危险期而变色
    const isLineInDanger = data.length > 0 && data[data.length - 1].b_value < ALERT_THRESHOLD;
    const lineColor = isLineInDanger ? '#ef4444' : '#3b82f6'; // 低于阈值变红，正常为蓝

    return (
        <div className="relative w-full h-full bg-slate-900 rounded-lg border border-slate-700 p-4 shadow-xl flex flex-col">
            {/* 顶部标题栏与动态警报标识 */}
            <div className="flex justify-between items-center mb-2">
                <h3 className="text-sm font-semibold text-slate-300">G-R 法则 b值 演化测井</h3>

                {/* 指示灯/预警提示徽章 */}
                <div className="flex items-center space-x-2">
                    <div className="text-xs text-slate-400">
                        最新 b 值: {data.length > 0 ? data[data.length - 1].b_value.toFixed(3) : '--'}
                    </div>
                    <div className={`w-3 h-3 rounded-full ${isLineInDanger ? 'bg-red-500 animate-pulse' : 'bg-green-500'}`} />
                </div>
            </div>

            {/* 核心图表区 */}
            <div className="flex-grow">
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                        <XAxis
                            dataKey="timestamp"
                            stroke="#94a3b8"
                            fontSize={10}
                            tickMargin={5}
                            tickFormatter={(val) => {
                                // 简化时间显示，仅显示 小时:分钟:秒
                                const d = new Date(val);
                                if (isNaN(d.getTime())) return '';
                                return d.toLocaleTimeString([], { hour12: false });
                            }}
                        />
                        {/* Y轴默认范围锚定在 0 - 2 之间，避免微小波动剧烈拉扯图表 */}
                        <YAxis
                            stroke="#94a3b8"
                            fontSize={10}
                            domain={[0, 2]}
                            ticks={[0, 0.4, 0.8, 1.2, 1.6, 2.0]}
                        />
                        <Tooltip
                            contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569', borderRadius: '4px' }}
                            itemStyle={{ color: '#fff' }}
                            labelStyle={{ color: '#94a3b8' }}
                            formatter={(value: any) => [Number(value).toFixed(3), 'b值']}
                            labelFormatter={(label) => {
                                const d = new Date(label);
                                return isNaN(d.getTime()) ? label : d.toLocaleTimeString();
                            }}
                        />

                        {/* 动态高危预警基准线 (ReferenceLine) */}
                        <ReferenceLine
                            y={ALERT_THRESHOLD}
                            stroke="#ef4444"
                            strokeDasharray="3 3"
                            label={{ position: 'top', value: `岩爆警戒线 (${ALERT_THRESHOLD.toFixed(2)})`, fill: '#ef4444', fontSize: 10 }}
                        />

                        <Line
                            type="monotone"
                            dataKey="b_value"
                            stroke={lineColor}
                            strokeWidth={2}
                            dot={false}
                            isAnimationActive={false} // 关闭动画以保证实时高频刷新的性能
                        />
                    </LineChart>
                </ResponsiveContainer>
            </div>

            {/* 屏幕级弹出通知 (Screen Notification Overlay) */}
            {showAlert && (
                <div className="absolute top-0 left-0 w-full h-full pointer-events-none flex items-center justify-center z-50">
                    <div className="bg-red-500/20 pointer-events-auto border border-red-500 text-red-50 px-6 py-4 rounded-xl shadow-2xl backdrop-blur-sm animate-pulse flex flex-col items-center max-w-[80%] text-center">
                        <svg className="w-8 h-8 text-red-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        <span className="font-bold text-lg mb-1">冲击地压极高危警告</span>
                        <span className="text-sm opacity-90">b值连续异常下降并跌破安全阈值，围岩应力已进入灾变演化阶段！</span>
                    </div>
                </div>
            )}
        </div>
    );
};
