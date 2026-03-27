# 千米深地围岩稳定性分析系统
(Thousand-Meter Deep Surrounding Rock Stability Analysis System)

## 架构概述
本系统主要用于千米深部岩体的稳定性监测与力学演化分析。采用前后端分离，外加核心力学引擎和高频监测微服务架构。

### 核心目录结构
- `/engine`: 存放 C++ 或 Python 编写的力学计算内核（如应力场计算）。
- `/monitor`: 实时接收 AE 声发射和传感器数据的 WebSocket 模块。
- `/frontend/src/visualizer`: Three.js 渲染组件，支持显示应力云图和震源定位点。
- `/backend`: Python FastAPI 业务后端，提供标准 REST API。

### 技术栈
- **前端**: React + TypeScript + Tailwind CSS + Three.js
- **后端**: Python FastAPI
- **分析引擎**: C++ / Python
- **数据库**:
  - PostgreSQL (存储项目信息及关系型数据)
  - InfluxDB (存储高频时序监测数据)

## 快速启动
运行 `docker-compose up -d` 即可启动基础数据库服务。
