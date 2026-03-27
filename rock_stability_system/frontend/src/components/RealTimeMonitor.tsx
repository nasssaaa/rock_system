import React, { useState, useEffect, useMemo } from 'react';
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    AreaChart,
    Area,
    Legend,
    ReferenceLine
} from 'recharts';
import { AlertTriangle, Activity, Zap, CheckCircle2 } from 'lucide-react';

interface AEDataPoint {
    time: string;
    eventCount: number;      // 频次 (个)
    energyRelease: number;   // 能量释放率 (J/s)
    isAlarm?: boolean;
}

interface RealTimeMonitorProps {
    energyThreshold?: number;
    externalDataStream?: any[]; // App 顶层传下来的 WebSocket 数据流
}

const RealTimeMonitor: React.FC<RealTimeMonitorProps> = ({
    energyThreshold = 5000,
    externalDataStream = []
}) => {
    // 监听传入的外部数据流以构建图表数据
    const chartData: AEDataPoint[] = useMemo(() => {
        if (!externalDataStream || externalDataStream.length === 0) return [];

        // 我们以 5 秒为一个 Window 分组计算频次和总能量释放
        // 为了简化实时展示，前端采用截取最近几十个点进行按秒级聚合或直接当作序列点展示
        // 这里采用每 1 个传进来的点作为一个时间步来平铺 (由于后端 mock stream 也是匀速发送的)

        // 限制展示最近 60 个点防止图表过密
        const recentPoints = externalDataStream.slice(-60);

        return recentPoints.map((pt, i) => {
            const timeObj = new Date(pt.id || Date.now() - (recentPoints.length - i) * 500);
            return {
                time: isNaN(timeObj.getTime()) ? String(i) : `${timeObj.getHours().toString().padStart(2, '0')}:${timeObj.getMinutes().toString().padStart(2, '0')}:${timeObj.getSeconds().toString().padStart(2, '0')}`,
                eventCount: pt.category === 'error' ? 0 : 1, // 这里如果是真实高并发，需累加，因为是一点一推，暂时计为1
                energyRelease: pt.energy || 0,
                isAlarm: (pt.energy || 0) > energyThreshold || pt.warning
            };
        });
    }, [externalDataStream, energyThreshold]);

    const latestPoint = chartData.length > 0 ? chartData[chartData.length - 1] : null;
    const isAlarmActive = latestPoint ? latestPoint.isAlarm : false;

    // 计算触发过警报的累计次数
    const alarmCount = useMemo(() => {
        return chartData.filter(d => d.isAlarm).length;
    }, [chartData]);


    return (
        <div className={`w-full h-full flex flex-col p-4 transition-colors duration-500 ease-in-out ${isAlarmActive ? 'bg-red-950/40 shadow-[inset_0_0_50px_rgba(220,38,38,0.2)]' : 'bg-transparent'}`}>

            {/* 头部状态看板 */}
            <div className="flex justify-between items-center mb-4 flex-shrink-0">
                <div>
                    <h2 className={`text-xl font-bold flex items-center gap-2 transition-colors ${isAlarmActive ? 'text-red-400' : 'text-slate-100'}`}>
                        <Activity className={isAlarmActive ? 'animate-pulse' : ''} size={20} />
                        实时能量释放率监测
                    </h2>
                </div>

                {/* 状态标或者报警器 */}
                <div className={`flex items-center gap-3 px-3 py-1.5 rounded-lg border text-sm ${isAlarmActive
                    ? 'bg-red-900/50 border-red-500 text-red-200 animate-pulse'
                    : 'bg-emerald-900/30 border-emerald-500/50 text-emerald-300'
                    }`}>
                    {isAlarmActive ? (
                        <>
                            <AlertTriangle className="w-5 h-5 text-red-400" />
                            <div className="leading-tight">
                                <div className="font-bold">能量破限</div>
                                <div className="text-[10px] text-red-300">当前窗: {alarmCount} 次异常</div>
                            </div>
                        </>
                    ) : (
                        <>
                            <CheckCircle2 className="w-5 h-5" />
                            <div className="font-medium">能量平稳</div>
                        </>
                    )}
                </div>
            </div>

            <div className="grid grid-rows-2 gap-4 flex-grow min-h-0">
                {/* 图表 1：AE频次密度 (暂时直接显示能量分布轮廓模拟密度) */}
                <div className="bg-slate-950/50 p-2 rounded border border-slate-800/80 relative min-h-0">
                    <div className="absolute top-2 right-2 text-[10px] font-mono text-blue-400 bg-blue-900/30 px-1.5 py-0.5 rounded">Energy Density</div>
                    <div className="h-full w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={chartData} margin={{ top: 20, right: 0, left: -20, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8} />
                                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                                <XAxis dataKey="time" stroke="#475569" fontSize={10} tickMargin={5} minTickGap={30} />
                                <YAxis stroke="#475569" fontSize={10} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.9)', borderColor: '#334155', color: '#f1f5f9', fontSize: '12px' }}
                                    itemStyle={{ color: '#60a5fa' }}
                                />
                                <Area
                                    type="monotone"
                                    dataKey="energyRelease"
                                    name="能量包络 (J)"
                                    stroke="#3b82f6"
                                    strokeWidth={1}
                                    fillOpacity={1}
                                    fill="url(#colorCount)"
                                    isAnimationActive={false}
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* 图表 2：绝对能量释放率阶梯图 */}
                <div className="bg-slate-950/50 p-2 rounded border border-slate-800/80 relative min-h-0">
                    <div className={`absolute top-2 right-2 text-[10px] font-mono px-1.5 py-0.5 rounded flex items-center gap-1 ${isAlarmActive ? 'text-red-400 bg-red-900/40 font-bold' : 'text-amber-400 bg-amber-900/30'}`}>
                        <Zap className="w-3 h-3" /> ERR (J/s)
                    </div>
                    <div className="h-full w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={chartData} margin={{ top: 20, right: 0, left: -10, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                                <XAxis dataKey="time" stroke="#475569" fontSize={10} tickMargin={5} minTickGap={30} />
                                <YAxis stroke="#475569" fontSize={10} domain={[0, 'auto']} />
                                <Tooltip
                                    contentStyle={{
                                        backgroundColor: isAlarmActive ? 'rgba(69, 10, 10, 0.9)' : 'rgba(15, 23, 42, 0.9)',
                                        borderColor: isAlarmActive ? '#7f1d1d' : '#334155',
                                        color: '#f8fafc',
                                        fontSize: '12px'
                                    }}
                                    itemStyle={{ color: isAlarmActive ? '#fca5a5' : '#fbbf24' }}
                                />

                                {/* 警戒线 */}
                                <ReferenceLine y={energyThreshold} stroke="#ef4444" strokeDasharray="3 3" label={{ position: 'insideTopLeft', value: '岩爆阈值', fill: '#ef4444', fontSize: 10 }} />

                                <Line
                                    type="stepAfter"
                                    dataKey="energyRelease"
                                    name="能效 (J/s)"
                                    stroke={isAlarmActive ? "#f87171" : "#fbbf24"}
                                    strokeWidth={2}
                                    dot={false}
                                    activeDot={{ r: 4, fill: isAlarmActive ? '#ef4444' : '#fbbf24' }}
                                    isAnimationActive={false}
                                />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default RealTimeMonitor;
