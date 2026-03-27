import React, { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export interface FloatingPanelProps {
    title: string;
    isOpen: boolean;
    onClose: () => void;
    children: React.ReactNode;
    defaultPosition?: { x: number; y: number };
    className?: string;
}

const FloatingPanel: React.FC<FloatingPanelProps> = ({ 
    title, 
    isOpen, 
    onClose, 
    children, 
    defaultPosition = { x: 100, y: 100 },
    className = ""
}) => {
    const [position, setPosition] = useState(defaultPosition);
    const [isDragging, setIsDragging] = useState(false);
    const dragOffset = useRef({ x: 0, y: 0 });

    useEffect(() => {
        if (!isOpen) return;

        const handleMouseMove = (e: MouseEvent) => {
            if (!isDragging) return;
            // 阻止文本选中，带来更好的拖拽体验
            e.preventDefault();
            setPosition({
                x: e.clientX - dragOffset.current.x,
                y: e.clientY - dragOffset.current.y
            });
        };

        const handleMouseUp = () => {
            setIsDragging(false);
        };

        if (isDragging) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging, isOpen]);

    const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
        // 防止拖拽时触发内部的点击事件
        setIsDragging(true);
        dragOffset.current = {
            x: e.clientX - position.x,
            y: e.clientY - position.y
        };
    };

    if (!isOpen) return null;

    return (
        <div 
            className={`fixed z-[100] flex flex-col shadow-2xl overflow-hidden rounded border border-slate-700 bg-slate-900/80 backdrop-blur-md outline-none ${className}`}
            style={{ 
                left: `${position.x}px`, 
                top: `${position.y}px`,
                boxShadow: isDragging ? '0 25px 50px -12px rgba(0,0,0,0.8)' : '0 10px 30px rgba(0,0,0,0.6)'
            }}
        >
            {/* Header / Drag Handle */}
            <div 
                className={`flex items-center justify-between px-3 py-2 border-b border-slate-700/60 cursor-move transition-colors ${isDragging ? 'bg-slate-800' : 'bg-slate-800/80 hover:bg-slate-800'}`}
                onMouseDown={handleMouseDown}
            >
                <div className="text-slate-300 font-mono text-xs font-semibold tracking-wider select-none truncate pr-8">
                    {title}
                </div>
                <button 
                    onClick={(e) => { 
                        e.stopPropagation(); 
                        onClose(); 
                    }} 
                    onMouseDown={(e) => e.stopPropagation()} // 防止点关闭按钮时不小心触发拖拽
                    className="text-slate-400 hover:text-red-400 hover:bg-slate-700/50 p-0.5 rounded transition-colors flex-shrink-0 cursor-pointer"
                >
                    <X size={16} />
                </button>
            </div>

            {/* Content Slot */}
            <div className="p-3 flex-grow overflow-auto min-h-0 text-slate-200 hide-scrollbar">
                {children}
            </div>
        </div>
    );
};

export default FloatingPanel;
