import React, { useState, useRef } from 'react';
import { X, ChevronDown, ChevronUp, RotateCcw, Settings, Download, Upload } from 'lucide-react';
import { useConfig } from '../contexts/ConfigContext';

interface AccordionItemProps {
    title: string;
    defaultOpen?: boolean;
    children: React.ReactNode;
}

const AccordionItem: React.FC<AccordionItemProps> = ({ title, defaultOpen = false, children }) => {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div className="border-b border-slate-800">
            <div
                className="px-4 py-3 flex justify-between items-center cursor-pointer hover:bg-slate-800 transition-colors"
                onClick={() => setOpen(!open)}
            >
                <span className="font-semibold text-slate-300 text-sm">{title}</span>
                {open ? <ChevronUp size={16} className="text-slate-500" /> : <ChevronDown size={16} className="text-slate-500" />}
            </div>
            {open && <div className="p-4 bg-slate-900/50 flex flex-col gap-5">{children}</div>}
        </div>
    );
};

// 通用带直接输入的滑块组件
const ACCENT_MAP: Record<string, string> = {
    indigo: 'accent-indigo-500',
    red: 'accent-red-500',
    amber: 'accent-amber-500',
    blue: 'accent-blue-500',
    emerald: 'accent-emerald-500',
};

const TEXT_COLOR_MAP: Record<string, string> = {
    indigo: 'text-indigo-400',
    red: 'text-red-400',
    amber: 'text-amber-400',
    blue: 'text-blue-400',
    emerald: 'text-emerald-400',
};

interface SliderInputProps {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    color?: string;
    suffix?: string;
    format?: (v: number) => string;
    onChange: (v: number) => void;
}

const SliderInput: React.FC<SliderInputProps> = ({ label, value, min, max, step, color = 'indigo', suffix, format, onChange }) => {
    const unitText = format ? format(value) : (suffix ? `${value}${suffix}` : null);
    const accentClass = ACCENT_MAP[color] || 'accent-indigo-500';
    const textColorClass = TEXT_COLOR_MAP[color] || 'text-indigo-400';

    return (
        <div>
            <div className="flex justify-between items-center mb-1.5">
                <span className="text-xs text-slate-400">{label}</span>
                <div className="flex items-center gap-1.5">
                    <input
                        type="number"
                        min={min}
                        max={max}
                        step={step}
                        value={value}
                        onChange={e => {
                            const n = Number(e.target.value);
                            if (!isNaN(n)) onChange(Math.min(max, Math.max(min, n)));
                        }}
                        className={`w-20 bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-right text-xs ${textColorClass} font-mono font-bold outline-none focus:border-slate-500`}
                    />
                    {unitText && <span className={`text-[10px] ${textColorClass} font-mono whitespace-nowrap`}>{unitText}</span>}
                </div>
            </div>
            <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={e => onChange(Number(e.target.value))}
                className={`w-full ${accentClass}`}
            />
        </div>
    );
};

interface SettingsPanelProps {
    isOpen: boolean;
    onClose: () => void;
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({ isOpen, onClose }) => {
    const { config, updateConfig, resetConfig } = useConfig();
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleExportConfig = () => {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(config, null, 2));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataStr);
        downloadAnchorNode.setAttribute("download", `rock_stability_config_${Date.now()}.json`);
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
    };

    const handleImportConfig = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const parsedConfig = JSON.parse(event.target?.result as string);
                updateConfig(parsedConfig);
            } catch (err) {
                console.error("Failed to parse config.json", err);
                alert("导入失败：配置文件格式不正确。");
            }
        };
        reader.readAsText(file);

        // Reset input so the same file can be selected again
        if (fileInputRef.current) {
            fileInputRef.current.value = "";
        }
    };

    return (
        <>
            {/* Backdrop */}
            {isOpen && (
                <div
                    className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 transition-opacity"
                    onClick={onClose}
                />
            )}

            {/* Side Panel */}
            <div className={`fixed inset-y-0 right-0 w-80 bg-slate-950 border-l border-slate-800 shadow-2xl z-50 transform transition-transform duration-300 ease-in-out flex flex-col ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}>

                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-900">
                    <div className="flex items-center gap-2 text-slate-200">
                        <Settings size={18} className="text-indigo-400" />
                        <h2 className="font-bold text-sm">系统参数设置</h2>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors bg-slate-800 p-1.5 rounded-md hover:bg-slate-700">
                        <X size={16} />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto custom-scrollbar">
                    {/* 1. 地质建模 */}
                    <AccordionItem title="地质建模 (Geological)" defaultOpen={true}>
                        <SliderInput label="初始地应力 σ₀ (MPa)" value={config.sigma0} min={10} max={100} step={1} color="indigo" onChange={v => updateConfig({ sigma0: v })} />
                        <SliderInput label="侧压力系数 k" value={config.kFactor} min={0.5} max={3.0} step={0.1} color="indigo" onChange={v => updateConfig({ kFactor: v })} format={v => v.toFixed(2)} />
                        <SliderInput label="岩石单轴抗压强度 UCS (MPa)" value={config.ucs} min={1} max={300} step={1} color="indigo" onChange={v => updateConfig({ ucs: v })} />
                        <SliderInput label="GSI 指数" value={config.gsi} min={10} max={100} step={1} color="indigo" onChange={v => updateConfig({ gsi: v })} />
                    </AccordionItem>

                    {/* 2. 监测预警 */}
                    <AccordionItem title="监测预警 (Monitoring)" defaultOpen={true}>
                        <SliderInput label="b值滑动窗口" value={config.bValueWindowSize} min={10} max={1000} step={10} color="indigo" onChange={v => updateConfig({ bValueWindowSize: v })} suffix=" 点" />
                        <SliderInput label="b值报警下限阈值" value={config.bValueThreshold} min={0.5} max={1.5} step={0.05} color="red" onChange={v => updateConfig({ bValueThreshold: v })} />
                        <SliderInput label="能量报警阈值" value={config.energyThreshold} min={1000} max={50000} step={500} color="red" onChange={v => updateConfig({ energyThreshold: v })} suffix=" J" />
                        <SliderInput label="微震频次生存时间" value={config.pointTTL} min={10} max={300} step={1} color="amber" onChange={v => updateConfig({ pointTTL: v })} suffix=" s" />
                        <SliderInput
                            label="回放查询时间半径" value={config.replayHalfRange} min={1} max={720} step={1} color="blue"
                            onChange={v => updateConfig({ replayHalfRange: v })}
                            format={v => v >= 60 ? `± ${(v / 60).toFixed(1)} h` : `± ${v} min`}
                        />
                        <SliderInput
                            label="Live 预加载历史时长" value={config.liveHistoryHours} min={0.1} max={6} step={0.1} color="emerald"
                            onChange={v => updateConfig({ liveHistoryHours: v })}
                            format={v => v < 1 ? `${Math.round(v * 60)} min` : `${v.toFixed(1)} h`}
                        />
                    </AccordionItem>

                    {/* 3. 视觉效果 */}
                    <AccordionItem title="视觉效果 (Visual Settings)" defaultOpen={true}>
                        <SliderInput label="AE 破裂点缩放比例" value={config.pointScale} min={0.1} max={5.0} step={0.1} color="indigo" onChange={v => updateConfig({ pointScale: v })} format={v => `${v.toFixed(1)}x`} />
                        <SliderInput label="巷道围岩透明度" value={config.tunnelOpacity} min={0} max={1} step={0.05} color="indigo" onChange={v => updateConfig({ tunnelOpacity: v })} format={v => `${Math.round(v * 100)}%`} />

                        <div className="grid grid-cols-2 gap-4">
                            <div className="flex flex-col gap-1">
                                <span className="text-xs text-slate-400">云图下限 (MPa)</span>
                                <input type="number" step="1" value={config.minStress} onChange={e => updateConfig({ minStress: Number(e.target.value) })} className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 font-mono focus:border-indigo-500 outline-none" />
                            </div>
                            <div className="flex flex-col gap-1">
                                <span className="text-xs text-slate-400">云图上限 (MPa, 变红)</span>
                                <input type="number" step="1" value={config.maxStress} onChange={e => updateConfig({ maxStress: Number(e.target.value) })} className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-red-400 font-bold font-mono focus:border-indigo-500 outline-none" />
                            </div>
                        </div>

                        <div className="flex justify-between items-center cursor-pointer pt-2 border-t border-slate-800" onClick={() => updateConfig({ showSupports: !config.showSupports })}>
                            <span className="text-xs text-slate-400">显示巷道支护结构</span>
                            <div className={`w-10 h-5 rounded-full relative transition-colors ${config.showSupports ? 'bg-indigo-600' : 'bg-slate-700'}`}>
                                <div className={`absolute top-0.5 bottom-0.5 w-4 bg-white rounded-full transition-transform ${config.showSupports ? 'translate-x-5' : 'translate-x-0.5'}`} />
                            </div>
                        </div>
                    </AccordionItem>
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-slate-800 bg-slate-900 flex flex-col gap-3">
                    <div className="flex gap-2">
                        <button
                            onClick={handleExportConfig}
                            className="flex-1 py-2 bg-indigo-900/30 hover:bg-indigo-800/60 text-indigo-300 rounded font-bold text-xs flex justify-center items-center gap-1.5 border border-indigo-700/50 transition-colors"
                        >
                            <Download size={14} />
                            导出方案
                        </button>
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            className="flex-1 py-2 bg-emerald-900/30 hover:bg-emerald-800/60 text-emerald-300 rounded font-bold text-xs flex justify-center items-center gap-1.5 border border-emerald-700/50 transition-colors"
                        >
                            <Upload size={14} />
                            导入方案
                        </button>
                        <input
                            type="file"
                            accept=".json"
                            ref={fileInputRef}
                            style={{ display: 'none' }}
                            onChange={handleImportConfig}
                        />
                    </div>

                    <button
                        onClick={resetConfig}
                        className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-bold text-xs flex justify-center items-center gap-2 border border-slate-700 transition-colors"
                    >
                        <RotateCcw size={14} />
                        恢复默认值 (Reset to Default)
                    </button>
                </div>
            </div>
        </>
    );
};

export default SettingsPanel;
