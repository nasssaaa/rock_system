import asyncio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

app = FastAPI(title="WebSocket 实时监测微服务", description="接收并分发 AE 声发射和传感器数据")

class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: str):
        for connection in self.active_connections:
            await connection.send_text(message)

manager = ConnectionManager()

@app.websocket("/ws/ae_data")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # 接收硬件上传的时序数据
            data = await websocket.receive_text()
            # todo: 将高频数据写入 InfluxDB
            
            # 广播给前端 Three.js visualizer 模块
            await manager.broadcast(f"New AE event: {data}")
    except WebSocketDisconnect:
        manager.disconnect(websocket)
