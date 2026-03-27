import React, { forwardRef } from 'react';

// Props passed down by ResponsiveGridLayout plus our own
export interface DashboardCardProps extends React.HTMLAttributes<HTMLDivElement> {
    title: string;
    children: React.ReactNode;
}

const DashboardCard = forwardRef<HTMLDivElement, DashboardCardProps>(
    ({ title, children, className = '', style, onMouseDown, onMouseUp, onTouchEnd, ...rest }, ref) => {
        return (
            <div
                ref={ref}
                className={`flex flex-col bg-slate-900 border border-slate-700/80 rounded-xl overflow-hidden shadow-2xl group ${className}`}
                style={style}
                onMouseDown={onMouseDown}
                onMouseUp={onMouseUp}
                onTouchEnd={onTouchEnd}
                {...rest}
            >
                {/* Drag Handle Area */}
                <div 
                    className="flex-shrink-0 flex items-center justify-between px-3 py-1.5 border-b border-slate-700/50 bg-slate-800/80 hover:bg-slate-700 cursor-move drag-handle transition-colors"
                >
                    <div className="text-slate-300 font-mono text-xs font-semibold tracking-wider select-none truncate flex items-center gap-2">
                        <span className="text-slate-500 text-[10px]">:::</span>
                        {title}
                    </div>
                </div>

                {/* Content Slot */}
                <div className="flex-grow p-2 overflow-hidden min-h-0 relative">
                    {children}
                </div>
            </div>
        );
    }
);

DashboardCard.displayName = 'DashboardCard';

export default DashboardCard;
