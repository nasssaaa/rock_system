import asyncio
import websockets

async def test():
    try:
        async with websockets.connect(
            'ws://127.0.0.1:8000/api/ws/monitor',
            extra_headers={
                "Origin": "http://localhost:5200",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            }
        ) as ws:
            print('Connected!')
            res = await ws.recv()
            print('Received:', res)
    except Exception as e:
        print('Error:', e)

asyncio.run(test())
