from fastapi import FastAPI, BackgroundTasks, HTTPException, WebSocket, WebSocketDisconnect, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List, Dict, Any
import os
import time
import asyncio
import json
import random
import sys

# 动态引入 engine 层依赖
ENGINE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../engine")
sys.path.append(ENGINE_DIR)
from python_wrapper.hoek_brown_calc import RockFailureCriterion
from python_wrapper.spatial_filter import SpatialPointFilter
from python_wrapper.b_value_calculator import BValueCalculator
import math

# 导入业务处理模块
from app.services.influxdb_service import influx_manager
from app.services.report_service import report_tool
from app.services.energy_magnitude import calculate_magnitude
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="围岩稳定性分析系统 API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 确保生成的报告有个临时目录存放
REPORTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "generated_reports")
os.makedirs(REPORTS_DIR, exist_ok=True)

@app.get("/c_hello")
async def c_hello(asker: str = None):
    """
    静默处理本地某些后台备份软件或杀毒软件 (如 Veeam 等) 发出的心跳扫描探测，
    防止控制台一直报 404 Not Found 的日志污染。
    """
    return {"status": "ok"}

class SensorDataPayload(BaseModel):
    sensor_id: str
    data: List[Dict[str, Any]]

class EngineCalcPayload(BaseModel):
    sigma0: float
    depth: float
    k: float # 侧压力系数
    ucs: float
    gsi: float # 地质强度指标

@app.post("/api/engine/calc")
def calculate_plastic_zone(payload: EngineCalcPayload):
    """
    接收前端配置栏下发的工程参数，结合 Hoek-Brown 经验强度准则，
    推算最新的围岩等效黏聚力、内摩擦角以及 Kastner 破裂塑性区半径。
    """
    # 1. 动态计算初始三维地应力张量
    # sigma0 为垂直主应力, 水平主应力为 k * sigma0
    vertical_stress = payload.sigma0
    horizontal_stress = payload.sigma0 * payload.k
    inplace_stress = (vertical_stress + 2 * horizontal_stress) / 3.0 # 等效平均体积主应力
    
    # 2. Hoek-Brown 演算获得等效 c, phi (根据输入的 UCS 和 GSI 热更新)
    # 假设扰动系数 D 为 0, m_i 为 15 (硬岩典型值)
    hb_engine = RockFailureCriterion(m_i=15.0)
    c, phi, _ = hb_engine.calculate_equivalent_mc_params(sigma_ci=payload.ucs, GSI=payload.gsi, D=0.0)
    
    # 3. 利用原岩应力与 c, phi 去 Kastner 模型求解破裂区
    # a 为默认巷道半径 3.0m
    R_p = report_tool._calculate_plastic_zone_radius(
        depth=payload.sigma0 * 40, # 模拟埋深等效值
        tunnel_radius=3.0, 
        c=c, 
        phi_deg=math.degrees(phi) if phi < math.pi else phi,
        inplace_stress=inplace_stress
    )
    
    return {
        "status": "success",
        "plastic_zone_radius": R_p,
        "cohesion_mpa": c,
        "friction_angle_deg": phi,
        "inplace_stress_mpa": inplace_stress
    }

@app.get("/")
def read_root():
    return {"message": "Welcome to Rock Stability Analysis System API"}

@app.get("/health")
def health_check():
    return {"status": "ok", "db_connected": False}

@app.post("/api/sensors/ingest")
async def ingest_sensor_data(payload: SensorDataPayload, background_tasks: BackgroundTasks):
    """
    接收来自传感器或 Monitor 服务的原始时序数据批量载荷。
    使用 BackgroundTasks 异步写入 InfluxDB (Raw Bucket) 
    并在数据量较大时触发降采样逻辑写入 Downsampled Bucket。
    """
    if not payload.data:
        raise HTTPException(status_code=400, detail="空数据载荷")
        
    num_points = len(payload.data)
    
    # 1. 异步写入原始高频数据 (Raw Bucket)
    background_tasks.add_task(
        influx_manager.write_raw_data, 
        measurement="ae_events_v2", 
        data_points=payload.data,
        tags={"sensor_id": payload.sensor_id}
    )
    
    # 2. 触发历史数据降采样逻辑并存储极值点 (Downsampled Bucket)
    # 如果一批传过来超过一定阈值（如每次推流凑够 200 个点），则执行 100:1 压缩
    if num_points >= 100:
        background_tasks.add_task(
            influx_manager.downsample_and_store,
            measurement="ae_events_downsampled",
            raw_data_points=payload.data,
            step=100
        )
        
    return {
        "status": "success", 
        "message": f"收到了 {num_points} 条监测数据，已加入后台异步写入与降采样队列。"
    }

@app.get("/api/sensors/history")
async def get_sensor_history(
    start_time: float = Query(..., description="Start timestamp in seconds"), 
    end_time: float = Query(..., description="End timestamp in seconds")
):
    """
    前端进度条拖拽时调用，从 InfluxDB 拉取历史记录以供 3D 批量渲染
    """
    if start_time >= end_time:
        raise HTTPException(status_code=400, detail="Invalid time range")
    
    # 因为 InfluxDB client 内部可能有阻塞 IO，可以利用 asyncio.to_thread 包装
    data = await asyncio.to_thread(influx_manager.query_historical_data, start_time, end_time)
    
    return {
        "status": "success", 
        "count": len(data),
        "data": data
    }

@app.get("/api/report/download", response_class=FileResponse)
async def generate_and_download_report(
    depth: float = 1000.0, 
    cohesion: float = 5.0, 
    friction: float = 35.0, 
    inplace_stress: float = 27.0, 
    radius: float = 3.0,
    ae_count: int = 1200,
    b_risk: float = 0.45
):
    """
    基于地质力学参数和近期微震活动，自动生成并下载围岩稳定性 PDF 报告。
    实际工程中这些默认参数会从数据库查询 (例如：读取由 InfluxDB 和 engine 算出的最新 24 小时状态)。
    """
    params = {
        'depth': depth,
        'cohesion': cohesion,
        'friction_angle': friction,
        'inplace_stress': inplace_stress,
        'tunnel_radius': radius,
        'ae_count_24h': ae_count,
        'max_energy': 8500.5, # Mock 最高能量
        'b_value_risk': b_risk
    }
    
    file_name = f"Stability_Report_{int(time.time())}.pdf"
    file_path = os.path.join(REPORTS_DIR, file_name)
    
    # 阻塞式生成（如需超大计算可丢入 BackgroundTasks 然后提供 websocket 下载进度）
    report_tool.generate_pdf(file_path, params)
    
    if not os.path.exists(file_path):
        raise HTTPException(status_code=500, detail="PDF 报告生成失败")
        
    return FileResponse(
        path=file_path, 
        filename=file_name, 
        media_type='application/pdf'
    )

@app.websocket("/ws/monitor")
async def websocket_monitor(websocket: WebSocket):
    """
    建立 WebSocket 连接，每隔 500ms 向前端推送模拟的微震破裂点及能量。
    (真实场景下这部分通常从 InfluxDB 订阅或引擎前置消费 Kafka 获取)
    """
    await websocket.accept()
    
    # 定义全局字典，供协程无锁读写共享状态
    ws_params = {
        "energyRatio": 1.0,
        "bValueWindowSize": 200,
        "bValueThreshold": 0.8
    }

    # 1. 建立并发监听任务，接收前端实时 SettingPanel 调整参数
    async def listen_for_params():
        try:
            while True:
                # 阻塞直到收到前端推送内容
                text_data = await websocket.receive_text()
                try:
                    new_params = json.loads(text_data)
                    ws_params.update(new_params)
                except json.JSONDecodeError:
                    pass
        except WebSocketDisconnect:
            pass
        except Exception as e:
            print(f"WS Listen Error: {e}")

    listen_task = asyncio.create_task(listen_for_params())
    
    # 初始化空间过滤器，采用默认 3.0m 巷道半径
    point_filter = SpatialPointFilter(tunnel_radius=3.0, center_x=0.0, center_y=0.0)
    b_value_calc = BValueCalculator(history_capacity=5)
    energy_buffer = []
    
    try:
        while True:
            t_start = time.perf_counter()

            # 读取动态滑块参数
            energy_ratio = float(ws_params.get("energyRatio", 1.0))
            b_window = int(ws_params.get("bValueWindowSize", 200))
            b_threshold = float(ws_params.get("bValueThreshold", 0.8))
            
            # 随机生成破裂点
            # X, Y 分布在中心附近直至深部 -10~10, Z 轴沿巷道长度 -10~10
            x = random.uniform(-10, 10)
            y = random.uniform(-10, 10)
            z = random.uniform(-10, 10)
            
            # 使用引擎层过滤策略判断，如果落在空腔内(d < R)，它会拦截并返回 None
            category = point_filter.filter_and_categorize(x, y, z)
            
            # 如果点不在真实围岩里（即定位误差点），根据需求直接舍弃，不经过任何渲染推流和入库操作
            if category is None:
                await asyncio.sleep(0.01) # 简单防阻塞
                continue
                
            # 能量生成：深部更容易诱发大能量突滑，叠加动态注入的比例乘数
            # (调低默认触发率 0.98/0.995，使得默认的微小破裂占绝大多数，保证基准 b 值健康(>1.0))
            is_burst = random.random() > (0.98 if category == 'deep' else 0.995)
            raw_energy = random.uniform(5000, 15000) if is_burst else random.uniform(10, 1000)
            energy = raw_energy * energy_ratio
            
            # 使用 b_value 计算器做动态滑动窗口预测
            energy_buffer.append(energy)
            if len(energy_buffer) > b_window:
                # 随前端配置随时收缩或扩张窗口
                energy_buffer = energy_buffer[-b_window:]
                
            warning_triggered, current_b, b_msg = b_value_calc.assess_risk_using_b_value(energy_buffer, alert_threshold=b_threshold)
            
            # 根据规范要求和前端动态配置进行告警比对
            is_warning = warning_triggered or (not math.isnan(current_b) and current_b < b_threshold)
            
            magnitude = calculate_magnitude(energy)

            event_data = {
                "x": round(x, 2),
                "y": round(y, 2),
                "z": round(z, 2),
                "energy": round(energy, 2),
                "magnitude": float(magnitude),
                "category": category,
                "timestamp": time.time(),
                "warning": is_warning
            }
            if not math.isnan(current_b):
                event_data["b_value"] = round(current_b, 3)
            
            t_end = time.perf_counter()
            proc_time_ms = (t_end - t_start) * 1000
            event_data["backend_proc_time_ms"] = round(proc_time_ms, 2)
            
            if proc_time_ms > 16.0:
                print(f"[Warning] Backend processing time exceeded 16ms: {proc_time_ms:.2f}ms")
            
            # 同时将产生的破裂点静默异步存入 InfluxDB
            # 增加 b_value 以便历史查询也能获取
            asyncio.get_event_loop().run_in_executor(
                influx_manager.executor,
                influx_manager.write_raw_data,
                "ae_events_v2",
                [event_data],
                {"source": "mock_ws"}
            )
            
            # 实时将 b_value 单独写入 stability_metrics 测量项中以供独立溯源分析
            if not math.isnan(current_b):
                stability_data = {
                    "b_value": round(current_b, 3),
                    "warning": is_warning,
                    "timestamp": event_data["timestamp"]
                }
                asyncio.get_event_loop().run_in_executor(
                    influx_manager.executor,
                    influx_manager.write_raw_data,
                    "stability_metrics",
                    [stability_data],
                    {"source": "mock_ws"}
                )
            
            await websocket.send_text(json.dumps(event_data))
            await asyncio.sleep(0.5)
            
    except WebSocketDisconnect:
        print("Frontend client disconnected from /ws/monitor")
    except Exception as e:
        print(f"WebSocket Error: {e}")
    finally:
        listen_task.cancel()

@app.on_event("shutdown")
def shutdown_event():
    influx_manager.close()
