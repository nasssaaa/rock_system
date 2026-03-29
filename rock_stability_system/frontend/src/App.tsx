import React, { useState, useEffect, useRef, useMemo } from 'react';
import { jsPDF } from 'jspdf';
import { AESphereData, StressDataPoint } from './visualizer/TunnelStressView';
import TunnelStressView from './visualizer/TunnelStressView';
import RealTimeMonitor from './components/RealTimeMonitor';
import LiveAlertTable from './visualizer/LiveAlertTable';
import { BValueTrendChart, BValueDataPoint } from './visualizer/BValueTrendChart';
import DashboardCard from './components/DashboardCard';
import { useConfig } from './contexts/ConfigContext';
import ComponentManager from './components/ComponentManager';
import SettingsPanel from './components/SettingsPanel';
import { Responsive, WidthProvider } from 'react-grid-layout/legacy';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

const ResponsiveGridLayout = WidthProvider(Responsive);

const DEFAULT_LAYOUTS: any = {
    lg: [
        { i: '3d-view', x: 0, y: 0, w: 12, h: 11, minW: 4, minH: 8 },
        { i: 'energy-chart', x: 0, y: 15, w: 6, h: 10, minW: 3, minH: 6 },
        { i: 'b-value-chart', x: 6, y: 15, w: 6, h: 10, minW: 3, minH: 6 },
        { i: 'log-list', x: 0, y: 27, w: 12, h: 10, minW: 4, minH: 5 },
        { i: 'alert-table', x: 6, y: 27, w: 12, h: 10, minW: 6, minH: 4 }
    ]
};

const getLayoutForItem = (layoutsSettings: any, id: string) => {
    // Attempt to salvage any preserved layout so when unhidden, it snaps back perfectly.
    for (const bp of ['lg', 'md', 'sm', 'xs', 'xxs']) {
        if (layoutsSettings[bp]) {
            const found = layoutsSettings[bp].find((l: any) => l.i === id);
            if (found) return found;
        }
    }
    return DEFAULT_LAYOUTS.lg.find((l: any) => l.i === id) || { x: 0, y: 0, w: 4, h: 4 };
};

function App() {
    // ----------------------------------------------------
    //  1. 同步引擎与主配置 State (Context API)
    // ----------------------------------------------------
    const { config, updateConfig } = useConfig();

    const [plasticZoneRadius, setPlasticZoneRadius] = useState<number>(3.0);
    const [calcStatus, setCalcStatus] = useState<string>('idle');
    const [calcResult, setCalcResult] = useState<any>(null);

    const handleSyncCalc = async () => {
        setCalcStatus('loading');
        try {
            const res = await fetch('/api/engine/calc', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sigma0: config.sigma0,
                    depth: config.sigma0 * 40, // fallback legacy 
                    k: config.kFactor,
                    ucs: config.ucs,
                    gsi: config.gsi
                })
            });
            const data = await res.json();
            if (data.status === 'success') {
                setPlasticZoneRadius(data.plastic_zone_radius);
                setCalcResult(data);
                setCalcStatus('success');
                setTimeout(() => setCalcStatus('idle'), 2000);
            }
        } catch (e) {
            console.error(e);
            setCalcStatus('error');
            setTimeout(() => setCalcStatus('idle'), 2000);
        }
    };

    // ----------------------------------------------------
    //  2. 全局 WebSocket 通信 & 实时数据分发
    // ----------------------------------------------------
    const [mode, setMode] = useState<'live' | 'history' | 'evolution'>('live');
    const [replayCenterTime, setReplayCenterTime] = useState<string>(() => {
        const now = new Date();
        const pad = (n: number) => n.toString().padStart(2, '0');
        return `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    });

    // Live 推流数据 (抛弃 setState 导致的全盘卡顿, 改为隐式缓存, 每秒同步 UI 图表 1 次)
    const liveAeEventsRef = useRef<AESphereData[]>(new Array(20000).fill(null));
    const liveEventsIndexRef = useRef<number>(0);
    const cumulativeStressDataRef = useRef<StressDataPoint[]>([]);
    const [uiTick, setUiTick] = useState(0);

    // Dashboard Layout State
    const [layouts, setLayouts] = useState<any>(() => {
        try {
            const saved = localStorage.getItem('rock-dashboard-layouts');
            if (saved) return JSON.parse(saved);
        } catch (e) { console.error('Error parsing layouts schema:', e); }
        return DEFAULT_LAYOUTS;
    });

    const [activeComponents, setActiveComponents] = useState<string[]>(() => {
        try {
            const saved = localStorage.getItem('rock-dashboard-active-components');
            if (saved) return JSON.parse(saved);
        } catch (e) { }
        return ['3d-view', 'log-list', 'energy-chart', 'b-value-chart', 'alert-table'];
    });

    const toggleComponent = (id: string) => {
        setActiveComponents((prev: string[]) => {
            const next = prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id];
            localStorage.setItem('rock-dashboard-active-components', JSON.stringify(next));
            return next;
        });
    };

    // Historical 返回数据
    const [historyData, setHistoryData] = useState<AESphereData[]>([]);
    const [historyStressData, setHistoryStressData] = useState<StressDataPoint[]>([]);
    const [evolutionEvents, setEvolutionEvents] = useState<AESphereData[]>([]);

    const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');

    const wsRef = useRef<WebSocket | null>(null);

    // Live Socket Connection
    useEffect(() => {
        if (mode !== 'live') return;

        // 预加载历史数据到环形缓冲区
        const preloadHistory = async () => {
            const now = Date.now() / 1000;
            const start = now - config.liveHistoryHours * 3600;
            try {
                const res = await fetch(`/api/sensors/history?start_time=${start}&end_time=${now}`);
                const json = await res.json();
                if (json.data && json.data.length > 0) {
                    console.log(`[Live] 预加载最近 ${config.liveHistoryHours}h 历史数据: ${json.data.length} 条`);
                    json.data.forEach((d: any) => {
                        const ev: AESphereData = {
                            id: (d.timestamp || 0).toString() + Math.random().toString(),
                            position: [d.x, d.y, d.z],
                            energy: d.energy,
                            category: d.category || (Math.sqrt(d.x ** 2 + d.y ** 2) < 3.0 ? 'error' : Math.sqrt(d.x ** 2 + d.y ** 2) <= 6.0 ? 'shallow' : 'deep'),
                            b_value: d.b_value,
                            warning: d.warning,
                            timestamp: d.timestamp,
                            magnitude: d.magnitude
                        };
                        const idx = liveEventsIndexRef.current % 20000;
                        liveAeEventsRef.current[idx] = ev;
                        liveEventsIndexRef.current += 1;
                    });
                    setUiTick(t => t + 1); // 触发一次UI刷新
                }
            } catch (e) {
                console.warn("[Live] 历史预加载失败:", e);
            }
        };
        preloadHistory();

        setWsStatus('connecting');
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${protocol}//${window.location.host}/ws/monitor`);
        wsRef.current = ws;

        // --- 1Hz UI Heartbeat 定时器 ---
        const uiInterval = setInterval(() => {
            setUiTick(t => t + 1);
        }, 1000);

        ws.onopen = () => {
            setWsStatus('connected');
            // 一旦连接成功，立刻将当前的配置同步给后端
            ws.send(JSON.stringify(config));
        };

        ws.onmessage = (event) => {
            const rxTime = performance.now();
            try {
                const data = JSON.parse(event.data);
                const newEvent: AESphereData = {
                    id: data.timestamp.toString() + Math.random().toString(),
                    position: [data.x, data.y, data.z],
                    energy: data.energy,
                    category: data.category,
                    b_value: data.b_value,
                    warning: data.warning,
                    timestamp: data.timestamp,
                    magnitude: data.magnitude,
                    ws_receive_time: rxTime
                };

                // 【环形缓冲区】：避免动态 Array.push/slice 引发 GC 内存回收顿挫
                const currentIndex = liveEventsIndexRef.current % 20000;
                liveAeEventsRef.current[currentIndex] = newEvent;
                liveEventsIndexRef.current += 1;

                const mappedSigma = Math.min(100, (data.energy / 10000) * 100);
                cumulativeStressDataRef.current = [
                    ...cumulativeStressDataRef.current.slice(-49),
                    { x: data.x, y: data.y, z: data.z, sigma: mappedSigma }
                ];
            } catch (e) {
                console.error("Invalid WS message format", e);
            }
        };

        ws.onclose = () => setWsStatus('disconnected');

        return () => {
            clearInterval(uiInterval);
            ws.close();
            wsRef.current = null;
        };
    }, [mode]);

    // ---- 监听 Config 变更，实时推送到 WS 供后端重算引擎热刷新 ----
    useEffect(() => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify(config));
        }
    }, [config]);

    // History Fetch Connection
    // 使用序列化字符串作为依赖项，避免对象引用变化导致 effect 反复重跑并取消 setTimeout
    const replayKey = `${replayCenterTime}|${config.replayHalfRange}`;
    useEffect(() => {
        if (mode !== 'history' && mode !== 'evolution') return;
        if (!replayCenterTime) return;

        const centerMs = new Date(replayCenterTime).getTime();
        if (isNaN(centerMs)) {
            console.warn("[History] Invalid center time:", replayCenterTime);
            return;
        }

        const halfRangeMs = config.replayHalfRange * 60 * 1000;
        const start = (centerMs - halfRangeMs) / 1000;
        const end = (centerMs + halfRangeMs) / 1000;

        console.log(`[History] Fetching data for ${mode}: center=${replayCenterTime}, ±${config.replayHalfRange}min`);

        let cancelled = false;
        const fetchHistory = async () => {
            try {
                const res = await fetch(`/api/sensors/history?start_time=${start}&end_time=${end}`);
                const json = await res.json();
                if (cancelled) return;
                console.log(`[History] Got ${json.count ?? json.data?.length ?? 0} points`);

                if (json.data) {
                    const mappedEvents: AESphereData[] = json.data.map((d: any) => ({
                        id: d.timestamp + Math.random(),
                        position: [d.x, d.y, d.z],
                        energy: d.energy,
                        category: d.category || (Math.sqrt(d.x ** 2 + d.y ** 2) < 3.0 ? 'error' : Math.sqrt(d.x ** 2 + d.y ** 2) <= 6.0 ? 'shallow' : 'deep'),
                        b_value: d.b_value,
                        warning: d.warning,
                        timestamp: d.timestamp,
                        magnitude: d.magnitude
                    }));

                    if (mode === 'history') {
                        setHistoryData(mappedEvents);
                        setHistoryStressData(json.data.map((d: any) => ({
                            x: d.x, y: d.y, z: d.z,
                            sigma: Math.min(100, (d.energy / 10000) * 100)
                        })));
                    } else if (mode === 'evolution') {
                        setEvolutionEvents(mappedEvents);
                    }
                }
            } catch (e) {
                console.error("[History] Failed to fetch:", e);
            }
        };

        fetchHistory();
        return () => { cancelled = true; };
    }, [mode, replayKey]);

    // 路由分拣渲染数据源
    const currentRenderData = useMemo(() => {
        if (mode === 'live') {
            const total = liveEventsIndexRef.current;
            const validCount = Math.min(total, 20000);
            if (validCount === 0) return [];

            // 为了保证时间顺序（对图表和取 top N 大小有帮助但不绝对必要），这里稍微重组环形缓冲队列
            // 但考虑到性能，我们仅在 UI Update Tick 或特殊需求时返回连续数组
            // 这里为了保证原本的逻辑，将环形缓冲拼接为线性连续历史 (新点在后)
            const arr = liveAeEventsRef.current;
            if (total <= 20000) return arr.slice(0, total);
            const pivot = total % 20000;
            return [...arr.slice(pivot), ...arr.slice(0, pivot)];
        }
        return mode === 'evolution' ? evolutionEvents : mode === 'history' ? historyData : [];
    }, [mode, evolutionEvents, historyData, uiTick]);

    // --- 提取 BValue 数据供图表消费 ---
    const bValueHistory: BValueDataPoint[] = useMemo(() => {
        const now = Date.now();
        return currentRenderData
            .filter(d => d.b_value !== undefined && d.b_value !== null)
            .map((d, i) => ({
                timestamp: d.timestamp ? new Date(d.timestamp * 1000).toISOString() : new Date(now - (currentRenderData.length - i) * 500).toISOString(),
                b_value: d.b_value!,
                warning: d.warning || false
            }));
    }, [currentRenderData, uiTick]);

    const magnitudeLogEvents = useMemo(() => {
        return currentRenderData.filter(d => d.magnitude !== undefined && d.magnitude > 0).slice(-30).reverse();
    }, [currentRenderData, uiTick]);

    const [isSettingsOpen, setIsSettingsOpen] = useState(false);

    // ----------------------------------------------------
    //  3. PDF Export 纯文字数据报告
    // ----------------------------------------------------
    const exportPDF = () => {
        const pdf = new jsPDF('portrait', 'mm', 'a4');
        const pageW = pdf.internal.pageSize.getWidth();
        const pageH = pdf.internal.pageSize.getHeight();
        const marginL = 15;
        const marginR = 15;
        const contentW = pageW - marginL - marginR;
        let y = 20;

        const checkPage = (needed: number) => {
            if (y + needed > pageH - 15) {
                pdf.addPage();
                y = 20;
            }
        };

        const addTitle = (text: string) => {
            checkPage(14);
            pdf.setFontSize(16);
            pdf.setFont('helvetica', 'bold');
            pdf.text(text, pageW / 2, y, { align: 'center' });
            y += 10;
        };

        const addSection = (text: string) => {
            checkPage(12);
            pdf.setFontSize(12);
            pdf.setFont('helvetica', 'bold');
            pdf.setDrawColor(100, 100, 100);
            pdf.line(marginL, y + 1, pageW - marginR, y + 1);
            y += 6;
            pdf.text(text, marginL, y);
            y += 8;
        };

        const addLine = (text: string, fontSize = 9) => {
            checkPage(6);
            pdf.setFontSize(fontSize);
            pdf.setFont('helvetica', 'normal');
            const lines = pdf.splitTextToSize(text, contentW);
            pdf.text(lines, marginL, y);
            y += lines.length * (fontSize * 0.45) + 2;
        };

        const addKeyValue = (key: string, value: string) => {
            checkPage(6);
            pdf.setFontSize(9);
            pdf.setFont('helvetica', 'bold');
            pdf.text(`${key}: `, marginL, y);
            const keyW = pdf.getTextWidth(`${key}: `);
            pdf.setFont('helvetica', 'normal');
            pdf.text(value, marginL + keyW, y);
            y += 5;
        };

        const addTableRow = (cols: string[], colWidths: number[], bold = false) => {
            checkPage(6);
            pdf.setFontSize(8);
            pdf.setFont('helvetica', bold ? 'bold' : 'normal');
            let xOffset = marginL;
            cols.forEach((col, i) => {
                pdf.text(col, xOffset, y);
                xOffset += colWidths[i];
            });
            y += 4.5;
        };

        const now = new Date();
        const fmtTime = (ts?: number) => ts ? new Date(ts * 1000).toLocaleString('zh-CN') : 'N/A';

        // ===== HEADER =====
        addTitle('Rock Stability Analysis Report');
        pdf.setFontSize(10);
        pdf.setFont('helvetica', 'normal');
        pdf.text('Deep Underground Rock Mass Spatiotemporal Evolution Warning System', pageW / 2, y, { align: 'center' });
        y += 7;
        addLine(`Report Generated: ${now.toLocaleString('zh-CN')}`);
        addLine(`Current Mode: ${mode.toUpperCase()}`);
        if (mode !== 'live') {
            addLine(`Replay Center Time: ${replayCenterTime}`);
            addLine(`Query Half Range: +/- ${config.replayHalfRange} min`);
        }
        addLine(`Total Data Points in View: ${currentRenderData.length}`);
        y += 3;

        // ===== 1. SYSTEM CONFIG =====
        addSection('1. System Configuration');
        addKeyValue('Initial Stress (sigma0)', `${config.sigma0} MPa`);
        addKeyValue('Lateral Pressure Coeff (k)', `${config.kFactor.toFixed(2)}`);
        addKeyValue('UCS', `${config.ucs} MPa`);
        addKeyValue('GSI', `${config.gsi}`);
        addKeyValue('B-Value Window', `${config.bValueWindowSize} points`);
        addKeyValue('B-Value Threshold', `${config.bValueThreshold.toFixed(2)}`);
        addKeyValue('Energy Threshold', `${config.energyThreshold} J`);
        addKeyValue('Point TTL', `${config.pointTTL} s`);
        addKeyValue('Replay Half Range', `${config.replayHalfRange} min`);
        addKeyValue('Live History Preload', `${config.liveHistoryHours} h`);
        if (calcResult) {
            addKeyValue('Plastic Zone Radius (Rp)', `${calcResult.plastic_zone_radius.toFixed(3)} m`);
        }
        y += 3;

        // ===== 2. EVENT STATISTICS =====
        addSection('2. Event Statistics Summary');
        const totalEvents = currentRenderData.length;
        const shallowCount = currentRenderData.filter(d => d.category === 'shallow').length;
        const deepCount = currentRenderData.filter(d => d.category === 'deep').length;
        const errorCount = currentRenderData.filter(d => d.category === 'error').length;
        const warningCount = currentRenderData.filter(d => d.warning).length;
        const energies = currentRenderData.map(d => d.energy);
        const minEnergy = energies.length > 0 ? Math.min(...energies) : 0;
        const maxEnergy = energies.length > 0 ? Math.max(...energies) : 0;
        const avgEnergy = energies.length > 0 ? energies.reduce((a, b) => a + b, 0) / energies.length : 0;
        const timestamps = currentRenderData.filter(d => d.timestamp).map(d => d.timestamp!);
        const firstTs = timestamps.length > 0 ? Math.min(...timestamps) : 0;
        const lastTs = timestamps.length > 0 ? Math.max(...timestamps) : 0;

        addKeyValue('Time Range', `${fmtTime(firstTs)}  ~  ${fmtTime(lastTs)}`);
        addKeyValue('Total Events', `${totalEvents}`);
        addKeyValue('Shallow Events', `${shallowCount} (${totalEvents ? (shallowCount / totalEvents * 100).toFixed(1) : 0}%)`);
        addKeyValue('Deep Events', `${deepCount} (${totalEvents ? (deepCount / totalEvents * 100).toFixed(1) : 0}%)`);
        addKeyValue('Error Events', `${errorCount} (${totalEvents ? (errorCount / totalEvents * 100).toFixed(1) : 0}%)`);
        addKeyValue('Warning Events', `${warningCount}`);
        addKeyValue('Energy Range', `${minEnergy.toFixed(1)} ~ ${maxEnergy.toFixed(1)} J`);
        addKeyValue('Average Energy', `${avgEnergy.toFixed(1)} J`);
        addKeyValue('Total Energy Released', `${energies.reduce((a, b) => a + b, 0).toFixed(1)} J`);
        y += 3;

        // ===== 3. ENERGY RELEASE DATA =====
        addSection('3. Energy Release Data (Last 60 Points)');
        const recentEnergy = currentRenderData.slice(-60);
        if (recentEnergy.length === 0) {
            addLine('No energy data available.');
        } else {
            const eCols = ['#', 'Time', 'X', 'Y', 'Z', 'Energy(J)', 'Category'];
            const eWidths = [8, 35, 18, 18, 18, 22, 22];
            addTableRow(eCols, eWidths, true);
            y += 1;
            recentEnergy.forEach((d, i) => {
                addTableRow([
                    String(i + 1),
                    fmtTime(d.timestamp),
                    d.position[0].toFixed(2),
                    d.position[1].toFixed(2),
                    d.position[2].toFixed(2),
                    d.energy.toFixed(1),
                    d.category || '-'
                ], eWidths);
            });
        }
        y += 3;

        // ===== 4. B-VALUE ANALYSIS =====
        addSection('4. B-Value Evolution Data');
        if (bValueHistory.length === 0) {
            addLine('No b-value data available.');
        } else {
            const bValues = bValueHistory.map(d => d.b_value);
            const bMin = Math.min(...bValues);
            const bMax = Math.max(...bValues);
            const bAvg = bValues.reduce((a, b) => a + b, 0) / bValues.length;
            const bWarnings = bValueHistory.filter(d => d.warning).length;

            addKeyValue('B-Value Range', `${bMin.toFixed(3)} ~ ${bMax.toFixed(3)}`);
            addKeyValue('B-Value Average', `${bAvg.toFixed(3)}`);
            addKeyValue('B-Value Latest', `${bValues[bValues.length - 1].toFixed(3)}`);
            addKeyValue('Below Threshold Count', `${bWarnings} / ${bValues.length}`);
            y += 2;

            const bCols = ['#', 'Timestamp', 'B-Value', 'Warning'];
            const bWidths = [8, 55, 25, 20];
            addTableRow(bCols, bWidths, true);
            y += 1;
            bValueHistory.slice(-40).forEach((d, i) => {
                addTableRow([
                    String(i + 1),
                    d.timestamp,
                    d.b_value.toFixed(3),
                    d.warning ? 'YES' : '-'
                ], bWidths);
            });
        }
        y += 3;

        // ===== 5. MAGNITUDE EVENTS =====
        addSection('5. Significant Magnitude Events (M > 0)');
        if (magnitudeLogEvents.length === 0) {
            addLine('No significant magnitude events recorded.');
        } else {
            const mCols = ['#', 'Time', 'Magnitude', 'Energy(J)', 'Category', 'Position'];
            const mWidths = [8, 35, 20, 22, 20, 40];
            addTableRow(mCols, mWidths, true);
            y += 1;
            magnitudeLogEvents.forEach((d, i) => {
                addTableRow([
                    String(i + 1),
                    fmtTime(d.timestamp),
                    `M ${d.magnitude?.toFixed(2) || '-'}`,
                    d.energy.toFixed(1),
                    d.category || '-',
                    `(${d.position[0].toFixed(1)}, ${d.position[1].toFixed(1)}, ${d.position[2].toFixed(1)})`
                ], mWidths);
            });
        }
        y += 3;

        // ===== 6. WARNING ALERTS =====
        addSection('6. Safety Warning Records');
        const alertEvents = currentRenderData.filter(d => d.warning).slice(-50);
        if (alertEvents.length === 0) {
            addLine('No active safety warnings in the current data window.');
        } else {
            addLine(`Total Warnings: ${alertEvents.length}`);
            y += 2;
            const aCols = ['#', 'Time', 'Energy(J)', 'B-Value', 'Category', 'Position'];
            const aWidths = [8, 35, 20, 18, 18, 42];
            addTableRow(aCols, aWidths, true);
            y += 1;
            alertEvents.forEach((d, i) => {
                addTableRow([
                    String(i + 1),
                    fmtTime(d.timestamp),
                    d.energy.toFixed(1),
                    d.b_value?.toFixed(3) || '-',
                    d.category || '-',
                    `(${d.position[0].toFixed(1)}, ${d.position[1].toFixed(1)}, ${d.position[2].toFixed(1)})`
                ], aWidths);
            });
        }
        y += 5;

        // ===== 7. FULL EVENT LOG =====
        addSection('7. Complete Event Log');
        addLine(`Total records: ${currentRenderData.length}. Showing all data points.`);
        y += 2;
        const fCols = ['#', 'Time', 'X', 'Y', 'Z', 'E(J)', 'Mag', 'Cat', 'b', 'Warn'];
        const fWidths = [8, 30, 14, 14, 14, 18, 12, 14, 14, 12];
        addTableRow(fCols, fWidths, true);
        y += 1;
        currentRenderData.forEach((d, i) => {
            addTableRow([
                String(i + 1),
                fmtTime(d.timestamp),
                d.position[0].toFixed(1),
                d.position[1].toFixed(1),
                d.position[2].toFixed(1),
                d.energy.toFixed(0),
                d.magnitude?.toFixed(1) || '-',
                d.category || '-',
                d.b_value?.toFixed(2) || '-',
                d.warning ? 'Y' : '-'
            ], fWidths);
        });

        // ===== FOOTER on last page =====
        y += 8;
        checkPage(10);
        pdf.setFontSize(8);
        pdf.setFont('helvetica', 'italic');
        pdf.text('-- End of Report --', pageW / 2, y, { align: 'center' });
        y += 5;
        pdf.text('Generated by Deep Underground Rock Mass Spatiotemporal Evolution Warning System', pageW / 2, y, { align: 'center' });

        pdf.save(`RockStability-Report-${now.toISOString().substring(0, 10)}.pdf`);
    };

    // ----------------------------------------------------
    //  DOM Render
    return (
        <div id="industrial-dashboard-root" className="min-h-screen bg-slate-950 text-slate-200 p-4 font-sans flex flex-col items-stretch max-h-screen overflow-hidden">
            {/* Header: Title / Controls */}
            <header className="flex-shrink-0 mb-4 flex items-center justify-between border-b-2 border-slate-800 pb-3">
                <div className="flex gap-4 items-center">
                    <div>
                        <h1 className="text-2xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-red-400">
                            深地围岩时空演变工业预警仪
                        </h1>
                        <p className="text-slate-400 mt-1 font-mono text-xs uppercase tracking-widest divide-x divide-slate-700">
                            <span className="pr-3">Geomechanics & AE Monitoring Room</span>
                            <span className={`pl-3 ${wsStatus === 'connected' ? 'text-emerald-400' : 'text-slate-500'}`}>
                                STATUS: {wsStatus.toUpperCase()}
                            </span>
                        </p>
                    </div>
                </div>

                <div className="flex gap-4 items-center">
                    {/* Mode Toggle Checkboxes Equivalent */}
                    <div className="bg-slate-900 border border-slate-700 rounded-md p-1 flex font-mono text-xs font-bold mr-4 gap-1">
                        <button onClick={() => setMode('live')} className={`px-4 py-1.5 rounded transition-all ${mode === 'live' ? 'bg-emerald-600 text-white shadow-[0_0_10px_rgba(5,150,105,0.8)]' : 'text-slate-500 hover:bg-slate-800'}`}>LIVE</button>
                        <button onClick={() => setMode('history')} className={`px-4 py-1.5 rounded transition-all ${mode === 'history' ? 'bg-blue-600 text-white shadow-[0_0_10px_rgba(37,99,235,0.8)]' : 'text-slate-500 hover:bg-slate-800'}`}>REPLAY</button>
                        <button onClick={() => setMode('evolution')} className={`px-4 py-1.5 rounded transition-all ${mode === 'evolution' ? 'bg-purple-600 text-white shadow-[0_0_10px_rgba(147,51,234,0.8)]' : 'text-slate-500 hover:bg-slate-800'}`}>EVOLUTION</button>
                    </div>

                    {/* Workspace Control */}
                    <div className="bg-slate-900/60 border border-slate-700 rounded-md p-1 flex font-mono text-xs font-bold mr-4 gap-1 items-center">
                        <span className="text-slate-500 px-3 flex items-center gap-1">布局控制</span>
                        <div className="h-4 w-px bg-slate-700 mr-1"></div>
                        <button
                            onClick={() => {
                                localStorage.removeItem('rock-dashboard-layouts');
                                localStorage.removeItem('rock-dashboard-active-components');
                                window.location.reload();
                            }}
                            className="px-3 py-1.5 rounded transition-all text-slate-400 hover:text-white hover:bg-slate-800"
                        >
                            RESTORE LAYOUT
                        </button>
                    </div>

                    <button
                        onClick={() => setIsSettingsOpen(true)}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 border border-indigo-500 text-white rounded shadow-[0_0_15px_rgba(79,70,229,0.4)] transition-all font-mono text-sm tracking-wide flex items-center gap-2 mr-2"
                    >
                        <span>⚙ PARAMETERS</span>
                    </button>

                    <button
                        onClick={exportPDF}
                        className="px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 rounded shadow-lg transition-all font-mono text-sm tracking-wide flex items-center gap-2"
                    >
                        <span>⎙ EXPORT LAYOUT PDF</span>
                    </button>
                </div>
            </header>

            {/* Config Control Engine Trigger (Visual only for Engine SYNC since config is in Modal now) */}
            <div className="flex-shrink-0 flex gap-4 text-xs font-mono mb-4 bg-slate-900/50 p-2 border border-slate-800 rounded justify-between flex-wrap">
                <div className="flex gap-4 items-center flex-wrap">
                    <button onClick={handleSyncCalc} className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded font-bold transition-all shadow-lg flex items-center gap-2">
                        <span>▶ SYNC GEOMECHANICS ENGINE</span>
                        <span className="opacity-70 text-[10px] bg-black/20 px-1.5 py-0.5 rounded">API</span>
                    </button>
                    {calcResult && <span className="text-emerald-400 border-l border-slate-700 pl-4 font-bold">Plastic Zone Rp = {calcResult.plastic_zone_radius.toFixed(2)}m</span>}
                </div>

                {/* Time Center Selector for History & Evolution */}
                {(mode === 'history' || mode === 'evolution') && (
                    <div className="flex items-center gap-3 bg-slate-800/80 px-3 py-1.5 rounded border border-slate-700">
                        <span className="text-slate-400 font-bold">查询时间:</span>
                        <input 
                            type="datetime-local" 
                            step="1"
                            value={replayCenterTime} 
                            onChange={e => setReplayCenterTime(e.target.value)} 
                            className="bg-slate-900 text-blue-400 border border-slate-600 rounded px-2 py-0.5 outline-none focus:border-blue-500" 
                        />
                        <span className="text-slate-500 bg-slate-900/80 px-2 py-0.5 rounded border border-slate-700">
                            ± {config.replayHalfRange >= 60 ? `${(config.replayHalfRange / 60).toFixed(1)}h` : `${config.replayHalfRange}min`}
                        </span>
                    </div>
                )}
            </div>

            {/* Setting Drawer */}
            <SettingsPanel isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />

            {/* Component Manager Sidebar */}
            <ComponentManager activeIds={activeComponents} onToggle={toggleComponent} />

            {/* Main Application Area */}
            <main className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar pb-12">
                <ResponsiveGridLayout
                    className="layout"
                    layouts={layouts}
                    breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
                    cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
                    rowHeight={30}
                    onLayoutChange={(currentLayout: any, allLayouts: any) => {
                        setLayouts((prev: any) => {
                            const mergedLayouts = { ...prev };
                            Object.keys(allLayouts).forEach(bp => {
                                const incomingMap = new Map((allLayouts[bp] || []).map((i: any) => [i.i, i]));
                                const existing = prev[bp] || [];
                                // preserve layouts of completely unmounted items!
                                const preservedItems = existing.filter((i: any) => !incomingMap.has(i.i));
                                mergedLayouts[bp] = [...allLayouts[bp], ...preservedItems];
                            });
                            localStorage.setItem('rock-dashboard-layouts', JSON.stringify(mergedLayouts));
                            return mergedLayouts;
                        });
                    }}
                    draggableHandle=".drag-handle"
                    margin={[12, 12]}
                >
                    {/* 3D View */}
                    {activeComponents.includes('3d-view') && (
                        <DashboardCard
                            key="3d-view"
                            title="围岩监测 3D 视界 (Instanced Rendering)"
                            data-grid={getLayoutForItem(layouts, '3d-view')}
                        >
                            <TunnelStressView
                                minStress={0}
                                maxStress={100}
                                plasticZoneRadius={plasticZoneRadius}
                                globalMode={mode}
                                globalRenderData={currentRenderData}
                                liveEventsRef={mode === 'live' ? liveAeEventsRef : undefined}
                                liveEventsTotalCount={mode === 'live' ? liveEventsIndexRef.current : undefined}
                                globalCumulativeStressData={mode === 'live' ? cumulativeStressDataRef.current : historyStressData}
                                showSupports={config.showSupports}
                            />
                        </DashboardCard>
                    )}

                    {/* Logs Panel */}
                    {activeComponents.includes('log-list') && (
                        <DashboardCard
                            key="log-list"
                            title="微震级强释能事件侧井记录 (M > 0)"
                            data-grid={getLayoutForItem(layouts, 'log-list')}
                        >
                            <div className="h-full w-full bg-slate-900 border border-slate-800 rounded flex flex-col min-h-0">
                                <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-1 p-2">
                                    {magnitudeLogEvents.length === 0 ? (
                                        <div className="text-slate-500 text-xs italic text-center mt-2">暂无剧烈破裂事件</div>
                                    ) : magnitudeLogEvents.map(ev => (
                                        <div key={ev.id} className="flex flex-col text-[10px] font-mono text-slate-300 bg-slate-800/40 rounded px-2 py-1.5 border-l-2 border-red-500">
                                            <div className="text-slate-500 mb-0.5">[{typeof ev.timestamp === 'number' ? new Date(ev.timestamp * 1000).toLocaleTimeString() : new Date().toLocaleTimeString()}]</div>
                                            <div className="flex items-center justify-between">
                                                <span className="font-bold text-emerald-400">M {ev.magnitude?.toFixed(1)}</span>
                                                <span className="text-amber-400">{(ev.energy / 1000).toFixed(1)} kJ</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </DashboardCard>
                    )}

                    {/* Energy Chart */}
                    {activeComponents.includes('energy-chart') && (
                        <DashboardCard
                            key="energy-chart"
                            title="实时能量释放趋势图 (ERR/s)"
                            data-grid={getLayoutForItem(layouts, 'energy-chart')}
                        >
                            <div className="w-full h-full -ml-3">
                                <RealTimeMonitor energyThreshold={config.energyThreshold} externalDataStream={currentRenderData} />
                            </div>
                        </DashboardCard>
                    )}

                    {/* B-Value Chart */}
                    {activeComponents.includes('b-value-chart') && (
                        <DashboardCard
                            key="b-value-chart"
                            title="微地震 Gutenberg-Richter b 值演化监控"
                            data-grid={getLayoutForItem(layouts, 'b-value-chart')}
                        >
                            <div className="w-full h-full">
                                <BValueTrendChart data={bValueHistory} />
                            </div>
                        </DashboardCard>
                    )}

                    {/* Live Alert Table Panel */}
                    {activeComponents.includes('alert-table') && (
                        <DashboardCard
                            key="alert-table"
                            title="安全生产干预预警指令台"
                            data-grid={getLayoutForItem(layouts, 'alert-table')}
                        >
                            <div className="h-full w-full rounded overflow-hidden">
                                <LiveAlertTable eventStream={currentRenderData} />
                            </div>
                        </DashboardCard>
                    )}
                </ResponsiveGridLayout>
            </main>
        </div>
    );
}

export default App;
