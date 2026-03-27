import React, { useMemo } from 'react';
import { AlertTriangle, AlertCircle, ShieldAlert } from 'lucide-react';
import { useConfig } from '../contexts/ConfigContext';
import { AESphereData } from './TunnelStressView';

interface LiveAlertTableProps {
    eventStream: AESphereData[];
}

const LiveAlertTable: React.FC<LiveAlertTableProps> = ({ eventStream }) => {
    const { config } = useConfig();
    
    // 过滤出含有 warning 标记的事件，按时间倒序
    const alerts = useMemo(() => {
        if (!eventStream) return [];
        return eventStream
            .filter(e => e.warning)
            .reverse()
            .slice(0, 50); // 只保留最近 50 条警告记录
    }, [eventStream]);

    const getLevelConfig = (energy: number, b_value?: number) => {
        if (b_value !== undefined && b_value < config.bValueThreshold) return { text: '极高危 (b值骤降)', color: 'text-red-500 bg-red-500/10 border-red-500/50', icon: <ShieldAlert size={14} className="text-red-500" /> };
        if (energy > config.energyThreshold * 1.5) return { text: '高危 (能量极值)', color: 'text-red-400 bg-red-400/10 border-red-400/50', icon: <AlertTriangle size={14} className="text-red-400" /> };
        if (energy > config.energyThreshold) return { text: '中危 (破纪录能量)', color: 'text-orange-400 bg-orange-400/10 border-orange-400/50', icon: <AlertCircle size={14} className="text-orange-400" /> };
        return { text: '预警 (异常簇集)', color: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/50', icon: <AlertCircle size={14} className="text-yellow-400" /> };
    };

    const getSuggestion = (category?: string) => {
        if (category === 'deep') return "立即撤离前方采掘面人员，启动深部微震强化监测预案，卸压钻孔施工。";
        if (category === 'shallow') return "加强巷道表面支护，检查锚杆托板受力情况，限制设备高频振动。";
        return "评估系统定位误差或进行多维阵列复核计算。";
    };

    return (
        <div className="w-full h-full flex flex-col">
            <div className="bg-slate-900 border-b border-slate-800 p-3 flex justify-between items-center flex-shrink-0">
                <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                    <ShieldAlert size={16} className="text-red-500" />
                    安全预警与应急处置看板
                </h3>
                <span className="text-xs text-slate-500 font-mono">
                    Total Active Alerts: <span className="text-red-400 font-bold">{alerts.length}</span>
                </span>
            </div>

            <div className="flex-1 overflow-auto bg-slate-950 p-2 custom-scrollbar min-h-0">
                {alerts.length === 0 ? (
                    <div className="h-full w-full flex flex-col items-center justify-center text-slate-600">
                        <ShieldAlert size={32} className="mb-2 opacity-50" />
                        <p className="text-sm">当前岩体形态稳定，无活跃预警</p>
                    </div>
                ) : (
                    <table className="w-full text-left border-collapse text-xs">
                        <thead className="sticky top-0 bg-slate-900 shadow-md z-10">
                            <tr>
                                <th className="p-2 border-b border-slate-800 text-slate-400 font-medium">时间 (Time)</th>
                                <th className="p-2 border-b border-slate-800 text-slate-400 font-medium">报警级别 (Level)</th>
                                <th className="p-2 border-b border-slate-800 text-slate-400 font-medium">位置 (XYZ)</th>
                                <th className="p-2 border-b border-slate-800 text-slate-400 font-medium">诱发能量 (J)</th>
                                <th className="p-2 border-b border-slate-800 text-slate-400 font-medium w-1/3">处置专家建议 (Remediation)</th>
                            </tr>
                        </thead>
                        <tbody className="font-mono">
                            {alerts.map((alert, idx) => {
                                const level = getLevelConfig(alert.energy, alert.b_value);
                                const timeFormat = new Intl.DateTimeFormat('zh-Hans', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(alert.timestamp ? new Date(alert.timestamp * 1000) : new Date());

                                return (
                                    <tr key={idx} className="border-b border-slate-800/50 hover:bg-slate-900/50 transition-colors">
                                        <td className="p-2 text-slate-300">{timeFormat}</td>
                                        <td className="p-2">
                                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border ${level.color} whitespace-nowrap`}>
                                                {level.icon} {level.text}
                                            </span>
                                        </td>
                                        <td className="p-2 text-slate-400">
                                            [{alert.position[0].toFixed(1)}, {alert.position[1].toFixed(1)}, {alert.position[2].toFixed(1)}]
                                        </td>
                                        <td className="p-2 text-rose-400 font-bold">
                                            {alert.energy.toFixed(0)}
                                        </td>
                                        <td className="p-2 text-slate-400 text-[11px] font-sans leading-relaxed">
                                            {getSuggestion(alert.category)}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
};

export default LiveAlertTable;
