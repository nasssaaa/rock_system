import os
from influxdb_client import InfluxDBClient

# InfluxDB 配置参数 (匹配 docker-compose.yml 和 influxdb_service.py)
INFLUXDB_URL = os.getenv("INFLUXDB_URL", "http://localhost:8086")
INFLUXDB_TOKEN = os.getenv("INFLUXDB_TOKEN", "my-super-secret-admin-token")
INFLUXDB_ORG = os.getenv("INFLUXDB_ORG", "rock_org")
INFLUXDB_BUCKET_RAW = os.getenv("INFLUXDB_BUCKET_RAW", "ae_data")
INFLUXDB_BUCKET_DOWN = os.getenv("INFLUXDB_BUCKET_DOWN", "ae_data_downsampled")

def clear_ae_data():
    """连接到 InfluxDB 并利用 Delete API 清空指定 Bucket 下的历史 AE 数据"""
    print(f"Connecting to InfluxDB at {INFLUXDB_URL}...")
    client = InfluxDBClient(url=INFLUXDB_URL, token=INFLUXDB_TOKEN, org=INFLUXDB_ORG)
    
    delete_api = client.delete_api()
    
    start_time = "1970-01-01T00:00:00Z"
    
    # 因为 InfluxDB2 删除时需指定 Stop 时间，所以我们这里使用一个极远的未来时间或者当前系统的 ISO 格式时间
    from datetime import datetime, timezone
    end_time = datetime.now(timezone.utc).isoformat()
    
    try:
        try:
            print(f"Clearing RAW ae_events_v2 in bucket: {INFLUXDB_BUCKET_RAW}")
            # 这里指定 measurement = "ae_events_v2"，因为代码里写入的测量项是 ae_events_v2
            delete_api.delete(
                start=start_time,
                stop=end_time,
                predicate='_measurement="ae_events_v2"',
                bucket=INFLUXDB_BUCKET_RAW,
                org=INFLUXDB_ORG
            )
        except Exception as e:
            if "not found" in str(e).lower():
                print(f"Bucket {INFLUXDB_BUCKET_RAW} not found (skip).")
            else:
                raise e
        
        try:
            print(f"Clearing DOWNSAMPLED events in bucket: {INFLUXDB_BUCKET_DOWN}")
            delete_api.delete(
                start=start_time,
                stop=end_time,
                predicate='_measurement="ae_events_downsampled"',
                bucket=INFLUXDB_BUCKET_DOWN,
                org=INFLUXDB_ORG
            )
        except Exception as e:
            if "not found" in str(e).lower():
                print(f"Bucket {INFLUXDB_BUCKET_DOWN} not found (skip).")
            else:
                raise e
        
        print("数据库已重置")
        
    except Exception as e:
        print(f"Error during InfluxDB deletion: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    clear_ae_data()
