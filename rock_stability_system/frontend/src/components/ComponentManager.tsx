import React, { useState } from 'react';
import { LayoutDashboard, Eye, EyeOff, Box, Activity, TrendingUp, FileText, Bell } from 'lucide-react';

export interface ComponentConfig {
    id: string;
    name: string;
    icon: React.ElementType;
}

export const AVAILABLE_COMPONENTS: ComponentConfig[] = [
    { id: '3d-view', name: '3D 巷道视图', icon: Box },
    { id: 'b-value-chart', name: 'b值变化分析', icon: TrendingUp },
    { id: 'energy-chart', name: '能量释放监测', icon: Activity },
    { id: 'log-list', name: '实时系统日志', icon: FileText },
    { id: 'alert-table', name: '高频预警列表', icon: Bell },
];

interface ComponentManagerProps {
    activeIds: string[];
    onToggle: (id: string) => void;
}

const ComponentManager: React.FC<ComponentManagerProps> = ({ activeIds, onToggle }) => {
    const [isExpanded, setIsExpanded] = useState(false);

    return (
        <div className="fixed left-0 top-1/4 z-50 flex shadow-2xl drop-shadow-2xl">
            {/* Main Panel */}
            <div className={`bg-slate-900/95 backdrop-blur-md border border-slate-700/50 rounded-r-xl overflow-hidden flex flex-col transition-all duration-300 ${isExpanded ? 'w-64 opacity-100' : 'w-0 opacity-0 border-none'}`}>
                <div className="p-4 border-b border-slate-700/50 bg-slate-800/50">
                    <h3 className="text-white font-medium flex items-center gap-2">
                        <LayoutDashboard size={18} className="text-cyan-400" />
                        组件管理器
                    </h3>
                </div>
                
                <div className="flex-1 py-2 overflow-y-auto">
                    {AVAILABLE_COMPONENTS.map(comp => {
                        const isActive = activeIds.includes(comp.id);
                        const Icon = comp.icon;
                        
                        return (
                            <div 
                                key={comp.id}
                                className="flex items-center justify-between px-4 py-3 hover:bg-slate-800/50 transition-colors group cursor-pointer"
                                onClick={() => onToggle(comp.id)}
                            >
                                <div className="flex items-center gap-3">
                                    <div className={`p-1.5 rounded-lg ${isActive ? 'bg-cyan-900/50 text-cyan-400' : 'bg-slate-800 text-slate-500'}`}>
                                        <Icon size={16} />
                                    </div>
                                    <span className={`text-sm font-medium transition-colors ${isActive ? 'text-slate-200' : 'text-slate-500'}`}>
                                        {comp.name}
                                    </span>
                                </div>
                                <button className={`p-1.5 rounded-md transition-colors ${isActive ? 'text-cyan-400 hover:bg-cyan-900/50' : 'text-slate-600 hover:bg-slate-800'}`}>
                                    {isActive ? <Eye size={18} /> : <EyeOff size={18} />}
                                </button>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Toggle Button */}
            <button 
                onClick={() => setIsExpanded(!isExpanded)}
                className="bg-slate-900/90 backdrop-blur-md border-y border-r border-slate-700/50 text-slate-300 p-3 rounded-r-xl shadow-[4px_0_24px_-4px_rgba(0,0,0,0.5)] hover:text-cyan-400 hover:bg-slate-800/90 transition-colors flex items-center justify-center h-16 mt-4 cursor-pointer"
            >
                <LayoutDashboard size={24} />
            </button>
        </div>
    );
};

export default ComponentManager;
