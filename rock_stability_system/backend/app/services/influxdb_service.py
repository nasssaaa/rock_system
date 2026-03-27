import os
from typing import List, Dict, Any
from influxdb_client import InfluxDBClient, Point
from influxdb_client.client.write_api import SYNCHRONOUS
from concurrent.futures import ThreadPoolExecutor

# InfluxDB 配置参数 (匹配 docker-compose.yml 设定)
INFLUXDB_URL = os.getenv("INFLUXDB_URL", "http://localhost:8086")
INFLUXDB_TOKEN = os.getenv("INFLUXDB_TOKEN", "my-super-secret-admin-token") # 需与实际对齐，这里为示例
INFLUXDB_ORG = os.getenv("INFLUXDB_ORG", "rock_org")
INFLUXDB_BUCKET_RAW = os.getenv("INFLUXDB_BUCKET_RAW", "ae_data")
INFLUXDB_BUCKET_DOWN = os.getenv("INFLUXDB_BUCKET_DOWN", "ae_data_downsampled")

class InfluxDBManager:
    """
    负责管理与 InfluxDB 的连接和数据读写操作。
    """
    def __init__(self):
        self.client = InfluxDBClient(url=INFLUXDB_URL, token=INFLUXDB_TOKEN, org=INFLUXDB_ORG)
        # 初始化写 API: 为了与 BackgroundTasks 兼容并保证性能，
        # 在实际高并发场景可配置为 ASYNCHRONOUS 或批处理模式
        self.write_api = self.client.write_api(write_options=SYNCHRONOUS)
        
        # 使用线程池处理降采样密集型计算
        self.executor = ThreadPoolExecutor(max_workers=4)
        
    def write_raw_data(self, measurement: str, data_points: List[Dict[str, Any]], tags: Dict[str, str] = None):
        """
        向 InfluxDB 写入原始高频传感器数据。
        设计为给 FastAPI 的 BackgroundTasks 调用，以避免阻塞主线程响应。
        
        :param measurement: 表名/测量指标名 (如 'ae_event')
        :param data_points: 数据字典列表，如 [{'energy': 1500, 'x': 10, 'y': 20, ...}, ...]
        :param tags: 给这批数据的公共标签 (如 {'sensor_id': 'S-01'})
        """
        try:
            points = []
            for dp in data_points:
                p = Point(measurement)
                if tags:
                    for k, v in tags.items():
                        p.tag(k, v)
                
                # 假设字典里除了特定元数据都是 fields
                for k, v in dp.items():
                    if v is None:
                        continue
                        
                    if k != 'time': # 如果有特定时间戳可以在这里 parse
                        if isinstance(v, (int, float)):
                            p.field(k, float(v))
                        else:
                            p.field(k, str(v))
                points.append(p)
                
            self.write_api.write(bucket=INFLUXDB_BUCKET_RAW, record=points)
            # print(f"[InfluxDB] 异步写入 {len(points)} 条原始 {measurement} 数据成功。")
            
        except Exception as e:
            print(f"[InfluxDB Error] 写入原始数据失败: {e}")

    def downsample_and_store(self, measurement: str, raw_data_points: List[Dict[str, float]], step: int = 100):
        """
        对传入的历史数据块进行降采样 (向下压缩)，提取每 `step` 个点组的极值。
        大幅度减少需要供 3D Visualizer 渲染的数据量。
        
        此函数同样供 BackgroundTasks 异步调用。
        
        :param measurement: 测量指标名 
        :param raw_data_points: 包含纯数值序列的字典列表 (需按时间排序输入)
        :param step: 聚合窗口大小 (默认100个点)
        """
        if not raw_data_points:
            return
            
        downsampled_points = []
        n_points = len(raw_data_points)
        
        try:
            for i in range(0, n_points, step):
                chunk = raw_data_points[i:i+step]
                
                # 寻找关键场极值 (例如：能量最大释放、位移最大值等)
                # 使用 chunk 内最大能量点的指标作为代表
                if not chunk:
                    continue
                    
                # 假设数据主要提取 'energy' 或默认使用第一个点作为底线，外加最大极值查找
                # 这里实现一个简单的通用极值提取：找到 chunk 中绝对值最大的那个数据点保留
                # (为简化，以 'energy' 字段为准，如果没有则降级选第一个)
                
                key_field = 'energy' if 'energy' in chunk[0] else list(chunk[0].keys())[0]
                
                if key_field in chunk[0]:
                    max_point = max(chunk, key_field=lambda x: abs(x.get(key_field, 0)))
                else:
                    max_point = chunk[0]
                    
                # 构造采样点存入低精度(高聚合) Bucket
                p = Point(measurement).tag("type", "downsampled").tag("step", str(step))
                for k, v in max_point.items():
                    if k != 'time' and isinstance(v, (int, float)):
                        p.field(k, float(v))
                        
                downsampled_points.append(p)
                
            # 写入专门的降采样 Bucket
            self.write_api.write(bucket=INFLUXDB_BUCKET_DOWN, record=downsampled_points)
            print(f"[InfluxDB] 降采样完成: {n_points} -> {len(downsampled_points)} (压缩率: {len(downsampled_points)/n_points:.2%})，写入成功。")
            
        except Exception as e:
            print(f"[InfluxDB Downsample Error] 降采样数据存储失败: {e}")

    def close(self):
        self.write_api.close()
        self.client.close()
        self.executor.shutdown(wait=False)

    def query_historical_data(self, start_ts: float, end_ts: float) -> List[Dict[str, Any]]:
        """
        根据指定时间戳范围查询 InfluxDB 中的历史微震 AE 事件。
        利用 Flux 语言从指定 bucket 拉取，并返回给客户端。
        针对开发联调/未启动 DB 的情况加入了 Fallback 保底机制。
        """
        try:
            query_api = self.client.query_api()
            from datetime import datetime, timezone
            # 格式化时间符合 Flux 规范 (RFC3339)
            start_iso = datetime.fromtimestamp(start_ts, tz=timezone.utc).isoformat()
            end_iso = datetime.fromtimestamp(end_ts, tz=timezone.utc).isoformat()
            
            query = f'''
            from(bucket: "{INFLUXDB_BUCKET_RAW}")
              |> range(start: {start_iso}, stop: {end_iso})
              |> filter(fn: (r) => r["_measurement"] == "ae_events_v2")
              |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
            '''
            
            tables = query_api.query(query, org=INFLUXDB_ORG)
            results = []
            for table in tables:
                for record in table.records:
                    results.append({
                        "x": record.values.get("x", 0.0),
                        "y": record.values.get("y", 0.0),
                        "z": record.values.get("z", 0.0),
                        "energy": record.values.get("energy", 0.0),
                        "timestamp": record.get_time().timestamp()
                    })
            if results:
                return results
                
            return []
            
        except Exception as e:
            print(f"[InfluxDB Query Error] 查询历史数据失败: {e}")
            return []

# 全局单例
influx_manager = InfluxDBManager()
